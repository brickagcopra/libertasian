"""Statute-aware retrieval (prod measurements, 2026-09-27).

(a) BM25 stopword poisoning: `citation_text` has no stopword handling, so
    "Rules of Court, Rule 139-A" matched the word "a" in every GENERAL /
    LEGAL_QUESTION query — 20 of 60 BM25 hits.
(b) Deep Research capped each document at 2 passages, so a whole code (the
    Civil Code is one document of 2,533 sections) could contribute 2 articles.
(c) Document-level rows of statutory documents are whole codes and took
    passage slots.
(d) A question that names "Article 1318 of the Civil Code" now fetches that
    article directly from PostgreSQL.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from src.config import settings
from src.core.ranked import RankedPassages
from src.core.retrieval import (
    STATUTORY_DOCUMENT_TYPES,
    _bm25_search,
    _knn_search,
    _statute_document_row_exclusion,
    strip_query_stopwords,
)
from src.core.schemas import Passage, RerankOutcome
from src.core.types import QueryIntent
from src.deep_research import pinpoint, service
from src.deep_research.pinpoint import (
    PinpointRef,
    collect_pinpoints,
    fetch_pinpoint_passages,
    parse_pinpoints,
)
from src.deep_research.schemas import DeepResearchRequest
from src.deep_research.service import add_pinpoints, merge_candidates

# ---------------------------------------------------------------------------
# 1. Stopwords + citation_text
# ---------------------------------------------------------------------------


async def _bm25_body(query: str, intent: QueryIntent) -> dict[str, Any]:
    captured: dict[str, Any] = {}

    async def _stub(_index: str, body: dict[str, Any]) -> dict[str, Any]:
        captured.update(body)
        return {"hits": {"hits": []}}

    with patch("src.core.retrieval.opensearch_search", side_effect=_stub):
        await _bm25_search(query, intent, top_k=5)
    return captured


def _multi_match(body: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = body["query"]["bool"]["must"][0]["multi_match"]
    return result


class TestStripQueryStopwords:
    def test_drops_the_poisoning_article(self) -> None:
        assert strip_query_stopwords("What is a contract of sale") == "What contract sale"

    def test_keeps_numbers_abbreviations_and_hyphenated_tokens(self) -> None:
        assert (
            strip_query_stopwords("the Art. 1318 and Sec. 5 of Rule 139-A")
            == "Art. 1318 Sec. 5 Rule 139-A"
        )

    def test_case_insensitive_and_edge_punctuation(self) -> None:
        assert strip_query_stopwords("A, THE (of) estafa?") == "estafa?"

    def test_only_stopwords_returns_the_query_unchanged(self) -> None:
        assert strip_query_stopwords("to be or not") == "to be or not"


class TestBm25StopwordsAndFields:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "intent", [i for i in QueryIntent if i != QueryIntent.CASE_LOOKUP]
    )
    async def test_non_case_intents_strip_stopwords_and_skip_citation_text(
        self, intent: QueryIntent
    ) -> None:
        mm = _multi_match(await _bm25_body("Is a contract void under Rule 139-A", intent))
        assert mm["query"] == "contract void under Rule 139-A"
        assert not any(f.split("^")[0] == "citation_text" for f in mm["fields"])

    @pytest.mark.asyncio
    async def test_case_lookup_is_unchanged(self) -> None:
        body = await _bm25_body("People of the Philippines v. A", QueryIntent.CASE_LOOKUP)
        mm = _multi_match(body)
        assert mm["query"] == "People of the Philippines v. A"
        assert mm["fields"] == ["citation_text^5", "title^3", "plain_text"]


# ---------------------------------------------------------------------------
# 2. Statute document-level rows are excluded on both legs
# ---------------------------------------------------------------------------


def _matches(clause: dict[str, Any], row: dict[str, Any]) -> bool:
    """Evaluate the (tiny) query DSL subset the exclusion uses against a row."""
    if "bool" in clause:
        b = clause["bool"]
        return all(_matches(c, row) for c in b.get("filter", [])) and not any(
            _matches(c, row) for c in b.get("must_not", [])
        )
    if "exists" in clause:
        return row.get(clause["exists"]["field"]) is not None
    if "term" in clause:
        ((field, value),) = clause["term"].items()
        return bool(row.get(field) == value)
    raise AssertionError(f"unsupported clause {clause}")


class TestStatuteDocumentRowExclusion:
    @pytest.mark.parametrize(
        ("row", "excluded"),
        [
            ({"document_type": "codal"}, True),
            ({"document_type": "rules_of_court"}, True),
            ({"document_type": "constitution"}, True),
            ({"document_type": "codal", "section_id": "s1"}, False),
            ({"document_type": "decision"}, False),
            ({"document_type": "decision", "section_id": "s1"}, False),
        ],
    )
    def test_semantics(self, row: dict[str, Any], excluded: bool) -> None:
        assert _matches(_statute_document_row_exclusion(), row) is excluded

    @pytest.mark.asyncio
    @pytest.mark.parametrize("intent", list(QueryIntent))
    async def test_bm25_excludes_in_filter_context(self, intent: QueryIntent) -> None:
        body = await _bm25_body("estafa", intent)
        bool_query = body["query"]["bool"]
        assert bool_query["must_not"] == [_statute_document_row_exclusion()]
        # must_not is filter context: nothing added to the scored clauses.
        assert len(bool_query["must"]) == 1

    @pytest.mark.asyncio
    async def test_knn_excludes_in_its_filter(self) -> None:
        captured: dict[str, Any] = {}

        async def _stub(_index: str, body: dict[str, Any]) -> dict[str, Any]:
            captured.update(body)
            return {"hits": {"hits": []}}

        with patch("src.core.retrieval.opensearch_search", side_effect=_stub):
            await _knn_search([0.1] * 384, top_k=5)
        knn_filter = captured["query"]["knn"]["embedding_vector"]["filter"]
        assert knn_filter["bool"]["must_not"] == [_statute_document_row_exclusion()]


# ---------------------------------------------------------------------------
# 3. Per-document cap depends on type
# ---------------------------------------------------------------------------


def _p(doc: str, section: str, score: float, document_type: str) -> Passage:
    return Passage(
        id=f"{doc}:{section}",
        document_id=doc,
        section_id=section,
        text="body text",
        document_type=document_type,
        score=score,
        rerank_score=score,
    )


class TestPerTypeCap:
    def test_default_statute_cap_is_six(self) -> None:
        assert settings.deep_research_max_per_statute == 6
        assert settings.deep_research_max_per_document == 2

    def test_statute_gets_its_own_cap_decision_keeps_two(self) -> None:
        code = [_p("civil", f"a{i}", 1 - i / 100, "codal") for i in range(10)]
        case = [_p("case", f"s{i}", 0.9 - i / 100, "decision") for i in range(10)]
        merged = merge_candidates(
            [code, case], max_candidates=40, max_per_document=2, max_per_statute=6
        )
        assert [p.section_id for p in merged if p.document_id == "civil"] == [
            f"a{i}" for i in range(6)
        ]
        assert sum(p.document_id == "case" for p in merged) == 2

    def test_every_statutory_type_uses_the_statute_cap(self) -> None:
        for document_type in STATUTORY_DOCUMENT_TYPES:
            rows = [_p("d", f"s{i}", 1 - i / 100, document_type) for i in range(10)]
            merged = merge_candidates(
                [rows], max_candidates=40, max_per_document=2, max_per_statute=6
            )
            assert len(merged) == 6, document_type

    def test_without_statute_cap_behaves_as_before(self) -> None:
        rows = [_p("d", f"s{i}", 1 - i / 100, "codal") for i in range(10)]
        assert len(merge_candidates([rows], max_candidates=40, max_per_document=2)) == 2


# ---------------------------------------------------------------------------
# 4. Pinpoint parser
# ---------------------------------------------------------------------------


class TestParsePinpoints:
    def test_civil_code_article(self) -> None:
        assert parse_pinpoints("Civil Code of the Philippines, Article 1318") == [
            PinpointRef("civil_code", "article", "1318")
        ]

    def test_art_abbreviation_with_rpc(self) -> None:
        assert parse_pinpoints("Art. 315 RPC") == [
            PinpointRef("revised_penal_code", "article", "315")
        ]

    def test_rule_section_means_rules_of_court(self) -> None:
        assert parse_pinpoints("Rule 113 Section 5") == [
            PinpointRef("rules_of_court", "section", "5", "113")
        ]

    def test_section_of_rule_order_and_suffix(self) -> None:
        assert parse_pinpoints("Sec. 5 of Rule 139-a") == [
            PinpointRef("rules_of_court", "section", "5", "139-A")
        ]

    def test_hyphenated_article(self) -> None:
        assert parse_pinpoints("rape under Article 266-A of the Revised Penal Code") == [
            PinpointRef("revised_penal_code", "article", "266-A")
        ]

    def test_article_without_a_code_is_ignored(self) -> None:
        assert parse_pinpoints("What does Article 36 say?") == []
        assert parse_pinpoints("Article III of the Constitution") == []

    def test_article_goes_to_the_nearest_code(self) -> None:
        refs = parse_pinpoints("Compare Article 36 of the Family Code with Art. 1318 Civil Code")
        assert refs == [
            PinpointRef("family_code", "article", "36"),
            PinpointRef("civil_code", "article", "1318"),
        ]

    def test_collect_dedupes_and_caps(self) -> None:
        texts = ["Art. 315 RPC", "Article 315 of the Revised Penal Code"] + [
            f"Article {n} Civil Code" for n in range(1, 10)
        ]
        refs = collect_pinpoints(texts, limit=4)
        assert len(refs) == 4
        assert refs[0] == PinpointRef("revised_penal_code", "article", "315")
        assert len(set(refs)) == 4

    def test_label_patterns_keep_the_dot(self) -> None:
        assert PinpointRef("civil_code", "article", "13").label_patterns() == [
            "Article 13.%",
            "Art. 13.%",
        ]


# ---------------------------------------------------------------------------
# 4b. Pinpoint fetch — parameterized SQL against a fake connection
# ---------------------------------------------------------------------------


DOC_ID = "11111111-1111-1111-1111-111111111111"
SEC_ID = "22222222-2222-2222-2222-222222222222"
NEXT_ID = "33333333-3333-3333-3333-333333333333"


class FakeConn:
    def __init__(self, anchor: int | None = None, title: str = "Civil Code") -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.anchor = anchor
        self.title = title

    async def fetch(self, sql: str, *args: Any) -> list[dict[str, Any]]:
        self.calls.append((sql, args))
        if "FROM legal_documents d" in sql:
            return [
                {
                    "id": DOC_ID,
                    "title": self.title,
                    "citation_text": "Republic Act No. 386",
                    "document_type": "codal",
                    "is_official": True,
                    "trust_level": "high",
                }
            ]
        return [
            {"id": SEC_ID, "section_label": "Article 1318.", "plain_text": "There is no contract"},
            {"id": NEXT_ID, "section_label": "Article 1319.", "plain_text": "Consent is shown"},
        ]

    async def fetchval(self, sql: str, *args: Any) -> Any:
        self.calls.append((sql, args))
        return self.anchor


class _Acquire:
    def __init__(self, conn: FakeConn) -> None:
        self.conn = conn

    async def __aenter__(self) -> FakeConn:
        return self.conn

    async def __aexit__(self, *_: object) -> None:
        return None


class TestFetchPinpointPassages:
    @pytest.mark.asyncio
    async def test_no_reference_never_touches_the_database(self) -> None:
        acquire = AsyncMock()
        with patch.object(pinpoint, "acquire_connection", acquire):
            assert await fetch_pinpoint_passages(["What is estafa?"]) == []
        acquire.assert_not_called()

    @pytest.mark.asyncio
    async def test_article_fetch_is_parameterized(self) -> None:
        conn = FakeConn()
        with patch.object(pinpoint, "acquire_connection", lambda: _Acquire(conn)):
            passages = await fetch_pinpoint_passages(
                ["Civil Code of the Philippines, Article 1318"]
            )

        assert [p.section_id for p in passages] == [SEC_ID, NEXT_ID]
        assert passages[0].document_id == DOC_ID
        assert passages[0].document_type == "codal"
        assert passages[0].source_authority_level == "high"

        doc_sql, doc_args = conn.calls[0]
        assert "$1" in doc_sql and "Civil Code" not in doc_sql
        assert "%Civil Code%" in doc_args[1]
        assert set(doc_args[0]) <= STATUTORY_DOCUMENT_TYPES

        section_sql, section_args = conn.calls[1]
        assert "1318" not in section_sql
        assert section_args == (DOC_ID, -1, ["Article 1318.%", "Art. 1318.%"])

    @pytest.mark.asyncio
    async def test_rule_section_anchors_after_the_rule_heading(self) -> None:
        conn = FakeConn(anchor=4200, title="Rules of Court")
        with patch.object(pinpoint, "acquire_connection", lambda: _Acquire(conn)):
            await fetch_pinpoint_passages(["Rule 113 Section 5"])

        doc_sql, doc_args = conn.calls[0]
        assert list(doc_args[0]) == ["rules_of_court"]
        anchor_sql, anchor_args = conn.calls[1]
        assert "~*" in anchor_sql and "113" not in anchor_sql
        assert anchor_args[0] == DOC_ID
        _, section_args = conn.calls[2]
        assert section_args == (DOC_ID, 4200, ["Section 5.%", "Sec. 5.%"])

    @pytest.mark.asyncio
    async def test_rule_missing_from_a_whole_rules_document_is_skipped(self) -> None:
        conn = FakeConn(anchor=None, title="Rules of Court")
        with patch.object(pinpoint, "acquire_connection", lambda: _Acquire(conn)):
            assert await fetch_pinpoint_passages(["Rule 113 Section 5"]) == []
        assert len(conn.calls) == 2  # document lookup + anchor; no section guess

    @pytest.mark.asyncio
    async def test_per_rule_document_needs_no_anchor(self) -> None:
        conn = FakeConn(anchor=None, title="Rule 113 - Arrest")
        with patch.object(pinpoint, "acquire_connection", lambda: _Acquire(conn)):
            passages = await fetch_pinpoint_passages(["Rule 113 Section 5"])
        assert passages
        assert conn.calls[2][1][1] == -1

    def test_rule_regex_does_not_match_a_suffixed_rule(self) -> None:
        import re

        pattern = re.compile(pinpoint._rule_regex("139"), re.IGNORECASE)
        assert pattern.search("RULE 139")
        assert pattern.search("Rule 139 - Disbarment")
        assert not pattern.search("RULE 139-A")
        assert not pattern.search("RULE 1390")

    @pytest.mark.asyncio
    async def test_database_failure_degrades_to_nothing(self) -> None:
        def broken() -> Any:
            raise OSError("connection refused")

        with patch.object(pinpoint, "acquire_connection", broken):
            assert await fetch_pinpoint_passages(["Art. 315 RPC"]) == []


# ---------------------------------------------------------------------------
# 4c. Pinpoints reach the pool before the rerank
# ---------------------------------------------------------------------------


class TestPinpointsInThePool:
    def test_add_pinpoints_prepends_dedupes_and_caps(self) -> None:
        pool = [_p("case", f"s{i}", 0.9, "decision") for i in range(5)]
        pinned = [_p("civil", "a1318", 0.0, "codal"), pool[0]]
        merged = add_pinpoints(pool, pinned, max_candidates=5)
        assert merged[0].section_id == "a1318"
        assert len(merged) == 5
        assert sum(p.section_id == "s0" for p in merged) == 1

    @pytest.mark.asyncio
    async def test_pipeline_reranks_the_pinpointed_article(self) -> None:
        article = _p("civil", "a1318", 0.0, "codal")
        others = [_p(f"case{i}", "s", 0.9, "decision") for i in range(3)]
        rerank = AsyncMock(return_value=RerankOutcome(passages=others, top_score=0.01))
        pinpoint_fetch = AsyncMock(return_value=[article])

        async def llm(**kwargs: Any) -> dict[str, Any]:
            plan = '{"scope": "in_scope", "sub_queries": ["Art. 1318 Civil Code"]}'
            return {"content": plan, "model_name": "m"}

        with (
            patch.object(service, "generate_completion_with_usage", AsyncMock(side_effect=llm)),
            patch.object(
                service,
                "retrieve_ranked",
                AsyncMock(return_value=RankedPassages(passages=others, candidates=3)),
            ),
            patch.object(service, "rerank_passages", rerank),
            patch.object(service, "fetch_pinpoint_passages", pinpoint_fetch),
        ):
            request = DeepResearchRequest(question="Which contracts are void?", run_id="r")
            _ = [event async for event in service.run_deep_research(request)]

        assert pinpoint_fetch.await_args is not None
        assert rerank.await_args is not None
        queries = pinpoint_fetch.await_args.args[0]
        assert queries == ["Which contracts are void?", "Art. 1318 Civil Code"]
        pool = rerank.await_args.args[1]
        assert pool[0].section_id == "a1318"
