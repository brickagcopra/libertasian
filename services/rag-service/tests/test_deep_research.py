"""Deep Research pipeline: planning, merge, verification and the SSE contract.

The LLM is mocked at `generate_completion_with_usage` (the one entry point the
pipeline uses), dispatched on the system prompt so each stage — planner,
writer, verifier — can be scripted independently. Retrieval, reranking and the
PostgreSQL section lookup are mocked at the module boundary.
"""

from __future__ import annotations

import asyncio
import json
from collections import Counter
from collections.abc import Callable
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from src.config import settings
from src.core import generation
from src.core.ranked import RankedPassages
from src.core.schemas import Passage, RerankOutcome
from src.deep_research import service
from src.deep_research.prompts import (
    MAX_QUOTE_WORDS,
    PLANNER_RESPONSE_FORMAT,
    PLANNER_SYSTEM_PROMPT,
    PROMPT_TEMPLATE_VERSION,
    VERIFIER_SYSTEM_PROMPT,
    WRITER_SYSTEM_PROMPT,
    verifier_response_format,
)
from src.deep_research.router import format_sse
from src.deep_research.schemas import (
    Citation,
    Claim,
    DeepResearchRequest,
    Draft,
    LabelledPassage,
    Section,
)
from src.deep_research.service import (
    extract_gr_no,
    filter_citations,
    match_quote,
    merge_candidates,
    run_deep_research,
)
from src.shared.exceptions import BudgetExceededError, ProviderQuotaExhaustedError

S1_TEXT = (
    "Psychological incapacity under Article 36 of the Family Code is a legal "
    "concept, not a medical illness, and need not be proven by expert opinion."
)
S2_TEXT = (
    "The incapacity must be grave, have juridical antecedence, and be incurable "
    "in the legal sense, existing at the time of the celebration of marriage."
)
S3_TEXT = (
    "A marriage contracted by any party who was psychologically incapacitated to "
    "comply with the essential marital obligations shall likewise be void."
)


def _passage(n: int, text: str, doc: str | None = None, score: float = 0.9) -> Passage:
    return Passage(
        id=f"hit-{n}",
        document_id=doc or f"doc-{n}",
        section_id=f"sec-{n}",
        title=f"Case {n}",
        citation_text=f"G.R. No. {196000 + n}",
        text=text,
        court="Supreme Court",
        decision_date="2021-05-11",
        document_type="decision",
        score=score,
        rerank_score=score,
    )


PASSAGES = [_passage(1, S1_TEXT), _passage(2, S2_TEXT), _passage(3, S3_TEXT)]


def _llm_result(content: dict[str, Any] | str, model: str = "m") -> dict[str, Any]:
    return {
        "content": content if isinstance(content, str) else json.dumps(content),
        "model_name": model,
        "model_version": f"{model}-2026-01-01",
        "tokens_in": 100,
        "tokens_out": 50,
    }


PLAN = {
    "scope": "in_scope",
    "sub_queries": ["Article 36 Family Code", "Tan-Andal v. Andal", "juridical antecedence"],
}


def _writer_answer(claims: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "summary": "Psychological incapacity is a legal concept.",
        "sections": [{"heading": "Nature", "claims": claims}],
    }


GOOD_CLAIM = {
    "text": "Psychological incapacity is a legal, not medical, concept.",
    "citations": [{"source_id": "S1", "quote": "is a legal concept, not a medical illness"}],
}


def _llm(
    *,
    plan: dict[str, Any] | Exception = PLAN,
    writer: dict[str, Any] | str | Exception | None = None,
    verifier: dict[str, Any] | Callable[[str], dict[str, Any]] | None = None,
) -> AsyncMock:
    """A scripted `generate_completion_with_usage` keyed on the system prompt."""

    async def fake(**kwargs: Any) -> dict[str, Any]:
        system = kwargs["system_prompt"]
        if system == PLANNER_SYSTEM_PROMPT:
            if isinstance(plan, Exception):
                raise plan
            return _llm_result(plan, kwargs["model"])
        if system == WRITER_SYSTEM_PROMPT:
            if isinstance(writer, Exception):
                raise writer
            return _llm_result(writer if writer is not None else _writer_answer([GOOD_CLAIM]),
                               kwargs["model"])
        if system == VERIFIER_SYSTEM_PROMPT:
            if callable(verifier):
                return _llm_result(verifier(kwargs["user_prompt"]), kwargs["model"])
            default = {"summary_supported": True,
                       "verdicts": {f"C{i}": True for i in range(1, 10)}}
            return _llm_result(verifier if verifier is not None else default, kwargs["model"])
        raise AssertionError(f"unexpected prompt {system[:40]}")

    return AsyncMock(side_effect=fake)


async def _collect(
    llm: AsyncMock,
    *,
    passages: list[Passage] | None = None,
    top_score: float | None = 0.9,
    request: DeepResearchRequest | None = None,
    rerank_outcome: RerankOutcome | None = None,
    mocks: dict[str, AsyncMock] | None = None,
) -> list[tuple[str, dict[str, Any]]]:
    reranked = PASSAGES if passages is None else passages
    ranked = AsyncMock(return_value=RankedPassages(passages=reranked, candidates=len(reranked)))
    rerank = AsyncMock(
        return_value=rerank_outcome or RerankOutcome(passages=reranked, top_score=top_score)
    )
    lookup = AsyncMock(return_value={})
    pinpoint = AsyncMock(return_value=[])
    if mocks is not None:
        mocks.update(retrieve=ranked, rerank=rerank, pinpoint=pinpoint, lookup=lookup)
    with (
        patch.object(service, "fetch_pinpoint_passages", pinpoint),
        patch.object(service, "generate_completion_with_usage", llm),
        patch.object(service, "retrieve_ranked", ranked),
        patch.object(service, "rerank_passages", rerank),
        patch.object(service, "lookup_section_metadata", lookup),
    ):
        req = request or DeepResearchRequest(question="What is psychological incapacity?",
                                             run_id="run-1")
        return [event async for event in run_deep_research(req)]


def _named(events: list[tuple[str, dict[str, Any]]], name: str) -> dict[str, Any]:
    matches = [data for event, data in events if event == name]
    assert len(matches) == 1, f"expected exactly one {name!r}, got {len(matches)}"
    return matches[0]


def _claims(result: dict[str, Any]) -> list[dict[str, Any]]:
    return [c for s in result["sections"] for c in s["claims"]]


# ---------------------------------------------------------------------------
# End to end through the generator
# ---------------------------------------------------------------------------


class TestPipeline:
    @pytest.mark.asyncio
    async def test_happy_path_emits_contract_in_order(self) -> None:
        events = await _collect(_llm())
        names = [e for e, _ in events]
        assert names == [
            "stage", "plan", "stage", "stage", "sources", "stage", "stage", "result", "done",
        ]
        stages = [d["stage"] for e, d in events if e == "stage"]
        assert stages == ["planning", "searching", "ranking", "writing", "verifying"]
        assert _named(events, "plan") == {"subQueries": PLAN["sub_queries"]}

        sources = _named(events, "sources")["sources"]
        assert [s["sourceId"] for s in sources] == ["S1", "S2", "S3"]
        assert set(sources[0]) == {
            "sourceId", "documentId", "sectionId", "title", "citation", "grNo",
            "court", "date", "sectionLabel", "documentType",
        }
        assert sources[0]["documentId"] == "doc-1"
        assert sources[0]["grNo"] == "G.R. No. 196001"

        result = _named(events, "result")
        assert result["abstained"] is False
        assert "abstainReason" not in result
        assert result["removedClaims"] == 0
        assert _claims(result)[0]["citations"] == [
            {"sourceId": "S1", "quote": "is a legal concept, not a medical illness"}
        ]

        done = _named(events, "done")
        assert done["runId"] == "run-1"
        assert done["promptTemplateVersion"] == PROMPT_TEMPLATE_VERSION
        assert done["modelName"] == settings.deep_research_model
        assert done["tokensIn"] == 300 and done["tokensOut"] == 150  # 3 LLM calls
        assert done["modelVersion"] == f"{settings.deep_research_model}-2026-01-01"
        assert isinstance(done["latencyMs"], int)

    @pytest.mark.asyncio
    async def test_every_llm_call_is_charged_to_ai_research(self) -> None:
        llm = _llm()
        await _collect(llm)
        assert llm.await_count == 3
        assert {c.kwargs["scope"] for c in llm.await_args_list} == {"ai_research"}
        models = [c.kwargs["model"] for c in llm.await_args_list]
        assert models == [
            settings.deep_research_planner_model,
            settings.deep_research_model,
            settings.deep_research_verifier_model,
        ]

    @pytest.mark.asyncio
    async def test_question_is_inside_untrusted_delimiters(self) -> None:
        llm = _llm()
        await _collect(llm)
        writer_prompt = llm.await_args_list[1].kwargs["user_prompt"]
        body = writer_prompt.split("---USER QUERY---")[1].split("---END USER QUERY---")[0]
        assert "What is psychological incapacity?" in body
        assert "[S1]" in writer_prompt.split("---END SOURCE PASSAGES---")[0]

    @pytest.mark.asyncio
    async def test_fabricated_source_id_is_dropped(self) -> None:
        claim = {
            "text": "Psychological incapacity is a legal concept.",
            "citations": [
                {"source_id": "S9", "quote": "is a legal concept, not a medical illness"},
                {"source_id": "S1", "quote": "is a legal concept, not a medical illness"},
            ],
        }
        events = await _collect(_llm(writer=_writer_answer([claim])))
        cites = _claims(_named(events, "result"))[0]["citations"]
        assert [c["sourceId"] for c in cites] == ["S1"]

    @pytest.mark.asyncio
    async def test_claim_citing_only_fabricated_ids_is_removed(self) -> None:
        bogus = {"text": "Made up.", "citations": [{"source_id": "S42", "quote": S1_TEXT[:40]}]}
        events = await _collect(_llm(writer=_writer_answer([GOOD_CLAIM, bogus])))
        result = _named(events, "result")
        assert [c["text"] for c in _claims(result)] == [GOOD_CLAIM["text"]]
        assert result["removedClaims"] == 1

    @pytest.mark.asyncio
    async def test_fake_quote_is_dropped(self) -> None:
        claim = {
            "text": "The incapacity must be grave.",
            "citations": [
                # Real label, invented wording.
                {"source_id": "S2", "quote": "must be severe and permanent in every case"},
                # Real wording, WRONG passage: it is in S2, not S3.
                {"source_id": "S3", "quote": "must be grave, have juridical antecedence"},
                # Verbatim modulo whitespace: kept.
                {"source_id": "S2", "quote": "must  be grave,\nhave juridical   antecedence"},
            ],
        }
        events = await _collect(_llm(writer=_writer_answer([claim])))
        cites = _claims(_named(events, "result"))[0]["citations"]
        assert cites == [{"sourceId": "S2", "quote": "must be grave, have juridical antecedence"}]

    @pytest.mark.asyncio
    async def test_unsupported_claim_is_removed_and_counted(self) -> None:
        second = {
            "text": "Incapacity must be incurable in the legal sense.",
            "citations": [{"source_id": "S2", "quote": "be incurable in the legal sense"}],
        }

        def verdicts(prompt: str) -> dict[str, Any]:
            assert "[C1]" in prompt and "[C2]" in prompt  # one batched call
            return {"summary_supported": True, "verdicts": {"C1": True, "C2": False}}

        events = await _collect(_llm(writer=_writer_answer([GOOD_CLAIM, second]),
                                     verifier=verdicts))
        result = _named(events, "result")
        assert [c["text"] for c in _claims(result)] == [GOOD_CLAIM["text"]]
        assert result["removedClaims"] == 1
        assert result["abstained"] is False

    @pytest.mark.asyncio
    async def test_claim_without_verdict_fails_closed(self) -> None:
        events = await _collect(_llm(verifier={"summary_supported": True, "verdicts": {}}))
        result = _named(events, "result")
        assert result["abstained"] is True
        assert result["abstainReason"] == "validation_failed"
        assert result["removedClaims"] == 1
        assert result["sections"] == []

    @pytest.mark.asyncio
    async def test_unsupported_summary_is_replaced_by_claims(self) -> None:
        events = await _collect(_llm(verifier={
            "summary_supported": False, "verdicts": {"C1": True},
        }))
        assert _named(events, "result")["summary"] == GOOD_CLAIM["text"]

    @pytest.mark.asyncio
    async def test_abstains_on_too_few_passages_without_writing(self) -> None:
        llm = _llm()
        events = await _collect(llm, passages=PASSAGES[:2])
        result = _named(events, "result")
        assert result["abstained"] is True
        assert result["abstainReason"] == "insufficient_passages"
        assert result["sections"] == [] and result["summary"]
        assert _named(events, "sources") == {"sources": []}
        assert _named(events, "done")["runId"] == "run-1"
        assert llm.await_count == 1  # planner only; the writer never ran

    @pytest.mark.asyncio
    async def test_abstains_on_low_raw_top_score(self) -> None:
        # The boosted head scores 0.9, but abstention reads the RAW top score.
        events = await _collect(_llm(), top_score=0.001)
        result = _named(events, "result")
        assert result["abstained"] is True
        assert result["abstainReason"] == "low_relevance"

    @pytest.mark.parametrize(
        "exc",
        [
            ProviderQuotaExhaustedError("LLM provider quota exhausted"),
            BudgetExceededError("cap", scope="ai_research", period="daily"),
        ],
    )
    @pytest.mark.asyncio
    async def test_quota_or_budget_error_is_budget_exhausted(self, exc: Exception) -> None:
        events = await _collect(_llm(plan=exc))
        assert events[-1] == (
            "error",
            {"code": "budget_exhausted", "message": service._BUDGET_MESSAGE},
        )
        assert "done" not in [e for e, _ in events]

    @pytest.mark.asyncio
    async def test_writer_quota_error_mid_stream_is_budget_exhausted(self) -> None:
        events = await _collect(_llm(writer=ProviderQuotaExhaustedError("x")))
        assert events[-1][0] == "error"
        assert events[-1][1]["code"] == "budget_exhausted"

    @pytest.mark.asyncio
    async def test_unexpected_error_is_internal_without_detail(self) -> None:
        events = await _collect(_llm(writer=RuntimeError("secret /etc/path")))
        assert events[-1] == ("error", {"code": "internal", "message": service._INTERNAL_MESSAGE})

    @pytest.mark.asyncio
    async def test_unparseable_writer_output_abstains(self) -> None:
        events = await _collect(_llm(writer="not json"))
        assert _named(events, "result")["abstainReason"] == "validation_failed"

    @pytest.mark.asyncio
    async def test_planner_garbage_still_searches_the_question(self) -> None:
        ranked = AsyncMock(return_value=RankedPassages(passages=PASSAGES, candidates=3))
        with (
            patch.object(service, "generate_completion_with_usage", _llm(plan={"x": 1})),
            patch.object(service, "retrieve_ranked", ranked),
            patch.object(service, "rerank_passages",
                         AsyncMock(return_value=RerankOutcome(passages=PASSAGES, top_score=0.9))),
            patch.object(service, "lookup_section_metadata", AsyncMock(return_value={})),
        ):
            events = [e async for e in run_deep_research(DeepResearchRequest(question="Q?"))]
        assert _named(events, "plan") == {"subQueries": []}
        assert [c.args[0] for c in ranked.await_args_list] == ["Q?"]

    @pytest.mark.asyncio
    async def test_model_override_used_when_allowlisted(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "deep_research_model_allowlist", "gpt-6-luna, gpt-4o")
        llm = _llm()
        events = await _collect(llm, request=DeepResearchRequest(
            question="Q?", model_override="gpt-6-luna"))
        assert llm.await_args_list[1].kwargs["model"] == "gpt-6-luna"
        assert _named(events, "done")["modelName"] == "gpt-6-luna"


# ---------------------------------------------------------------------------
# Retrieval fan-out and merge
# ---------------------------------------------------------------------------


class TestRetrieval:
    @pytest.mark.asyncio
    async def test_at_most_three_sub_queries_in_flight(self) -> None:
        in_flight = 0
        peak = 0

        async def slow(query: str, **_: Any) -> RankedPassages:
            nonlocal in_flight, peak
            in_flight += 1
            peak = max(peak, in_flight)
            await asyncio.sleep(0.01)
            in_flight -= 1
            return RankedPassages(passages=[_passage(len(query), query)])

        with patch.object(service, "retrieve_ranked", AsyncMock(side_effect=slow)):
            ranked, _ = await service.retrieve_all([f"q{i}" for i in range(6)])
        assert len(ranked) == 6
        assert peak == 3

    @pytest.mark.asyncio
    async def test_one_failed_sub_query_degrades(self) -> None:
        async def flaky(query: str, **_: Any) -> RankedPassages:
            if query == "bad":
                raise RuntimeError("opensearch down")
            return RankedPassages(passages=[], degraded_legs=["knn:not_configured"])

        with patch.object(service, "retrieve_ranked", AsyncMock(side_effect=flaky)):
            ranked, degraded = await service.retrieve_all(["good", "bad", "good2"])
        assert len(ranked) == 2
        assert degraded == ["knn:not_configured", "subquery:failed"]

    def test_merge_dedupes_by_section_keeping_best_score(self) -> None:
        a = _passage(1, "x", doc="d1", score=0.2)
        a_better = a.model_copy(update={"id": "other-hit", "rerank_score": 0.8})
        merged = merge_candidates([[a], [a_better]], max_candidates=40, max_per_document=2)
        assert len(merged) == 1
        assert merged[0].rerank_score == 0.8

    def test_merge_caps_per_document_and_overall(self) -> None:
        same_doc = [
            _passage(i, "x", doc="d1", score=1 - i / 100).model_copy(
                update={"section_id": f"s{i}"}
            )
            for i in range(5)
        ]
        many = [_passage(100 + i, "y", score=0.5) for i in range(60)]
        merged = merge_candidates([same_doc, many], max_candidates=40, max_per_document=2)
        assert len(merged) == 40
        assert sum(p.document_id == "d1" for p in merged) == 2
        # The two kept from d1 are its best two.
        assert [p.section_id for p in merged if p.document_id == "d1"] == ["s0", "s1"]


# ---------------------------------------------------------------------------
# Deterministic verification helpers
# ---------------------------------------------------------------------------


class TestFailClosedOnDegradedRerank:
    """No cross-encoder score, no answer: RRF order is not a relevance signal.

    On the prod gate 2026-09-28 abs-01 (a US case) and abs-02 (the German BGB)
    hit the 20 s reranker timeout, fell back to RRF, cleared the score
    threshold on a fusion score and were answered.
    """

    @pytest.mark.parametrize(
        "marker", ["reranker:unreachable", "reranker:failed", "reranker:not_configured"]
    )
    @pytest.mark.asyncio
    async def test_degraded_rerank_abstains_without_writing(self, marker: str) -> None:
        llm = _llm()
        degraded = RerankOutcome(
            passages=PASSAGES, degraded=True, degraded_legs=[marker], top_score=0.03
        )
        events = await _collect(llm, rerank_outcome=degraded)

        result = _named(events, "result")
        assert result["abstained"] is True
        assert result["abstainReason"] == "ranking_unavailable"
        assert _named(events, "sources") == {"sources": []}
        assert marker in _named(events, "done")["degradedLegs"]
        # Planner only: the writer and verifier never ran.
        assert llm.await_count == 1
        assert "writing" not in [d["stage"] for e, d in events if e == "stage"]

    @pytest.mark.asyncio
    async def test_degraded_retrieval_leg_alone_does_not_abstain(self) -> None:
        # A kNN leg that failed during search is not a rerank failure.
        ranked = AsyncMock(return_value=RankedPassages(
            passages=PASSAGES, candidates=3, degraded_legs=["knn:unreachable"]
        ))
        ok = RerankOutcome(passages=PASSAGES, top_score=0.9)
        with (
            patch.object(service, "fetch_pinpoint_passages", AsyncMock(return_value=[])),
            patch.object(service, "generate_completion_with_usage", _llm()),
            patch.object(service, "retrieve_ranked", ranked),
            patch.object(service, "rerank_passages", AsyncMock(return_value=ok)),
            patch.object(service, "lookup_section_metadata", AsyncMock(return_value={})),
        ):
            events = [e async for e in run_deep_research(DeepResearchRequest(question="Q?"))]
        assert _named(events, "result")["abstained"] is False
        assert "knn:unreachable" in _named(events, "done")["degradedLegs"]


class TestRerankBudget:
    def test_defaults(self) -> None:
        assert settings.deep_research_max_candidates == 30
        assert settings.deep_research_rerank_timeout == 30
        assert settings.reranker_timeout == 20  # /answer's budget is unchanged

    @pytest.mark.asyncio
    async def test_deep_research_rerank_uses_its_own_timeout(self) -> None:
        mocks: dict[str, AsyncMock] = {}
        await _collect(_llm(), mocks=mocks)
        mocks["rerank"].assert_awaited_once()
        assert mocks["rerank"].await_args.kwargs["timeout"] == 30


class TestPlannerScope:
    """The planner labels scope; anything but in_scope abstains before retrieval."""

    @pytest.mark.parametrize(
        ("scope", "question"),
        [
            ("non_ph_law", "What did the US Supreme Court hold in District of Columbia v. Heller?"),
            ("non_ph_law", "What does Section 823 of the German BGB provide?"),
            ("future_or_hypothetical", "What are the Philippine income tax rates for 2040?"),
            ("nonsense", "purple monkey dishwasher"),
        ],
    )
    @pytest.mark.asyncio
    async def test_out_of_scope_abstains_without_retrieval(
        self, scope: str, question: str
    ) -> None:
        llm = _llm(plan={"scope": scope, "sub_queries": ["should be ignored"]})
        mocks: dict[str, AsyncMock] = {}
        events = await _collect(llm, request=DeepResearchRequest(question=question), mocks=mocks)

        result = _named(events, "result")
        assert result["abstained"] is True
        assert result["abstainReason"] == "out_of_scope"
        assert _named(events, "plan") == {"subQueries": []}
        assert _named(events, "sources") == {"sources": []}
        mocks["retrieve"].assert_not_awaited()
        mocks["pinpoint"].assert_not_awaited()
        mocks["rerank"].assert_not_awaited()
        assert llm.await_count == 1  # planner only
        assert [d["stage"] for e, d in events if e == "stage"] == ["planning"]
        assert [e for e, _ in events][-1] == "done"

    @pytest.mark.asyncio
    async def test_comparative_ph_question_is_in_scope_and_researched(self) -> None:
        question = "Is the US Miranda rule applied in the Philippines?"
        plan = {
            "scope": "in_scope",
            "sub_queries": ["Article III Section 12 1987 Constitution custodial investigation"],
        }
        llm = _llm(plan=plan)
        mocks: dict[str, AsyncMock] = {}
        events = await _collect(llm, request=DeepResearchRequest(question=question), mocks=mocks)

        assert _named(events, "result")["abstained"] is False
        assert mocks["retrieve"].await_count == 2  # the question + its one sub-query
        planner_prompt = llm.await_args_list[0].kwargs["user_prompt"]
        body = planner_prompt.split("---USER QUERY---")[1].split("---END USER QUERY---")[0]
        assert question in body

    def test_planner_prompt_keeps_comparative_questions_in_scope(self) -> None:
        # The live model's labelling is measured by the golden set, not here;
        # this pins the instruction that comparative PH questions stay in scope.
        assert "Is the US Miranda rule applied in the Philippines?" in PLANNER_SYSTEM_PROMPT
        assert "untrusted user input" in PLANNER_SYSTEM_PROMPT

    def test_planner_schema_is_strict_with_scope_enum(self) -> None:
        assert PLANNER_RESPONSE_FORMAT["json_schema"]["strict"] is True
        schema = PLANNER_RESPONSE_FORMAT["json_schema"]["schema"]
        assert schema["required"] == ["scope", "sub_queries"]
        assert schema["properties"]["scope"]["enum"] == [
            "in_scope", "non_ph_law", "future_or_hypothetical", "nonsense",
        ]

    @pytest.mark.parametrize(
        "plan",
        [
            {"scope": "maybe", "sub_queries": ["x y z"]},  # label outside the enum
            {"sub_queries": ["x y z"]},  # scope missing
            {"scope": "in_scope", "sub_queries": "x y z"},  # wrong type
        ],
    )
    @pytest.mark.asyncio
    async def test_invalid_plan_still_searches_the_question(self, plan: dict[str, Any]) -> None:
        mocks: dict[str, AsyncMock] = {}
        events = await _collect(
            _llm(plan=plan), request=DeepResearchRequest(question="Q?"), mocks=mocks
        )
        assert _named(events, "plan") == {"subQueries": []}
        assert [c.args[0] for c in mocks["retrieve"].await_args_list] == ["Q?"]
        assert _named(events, "result")["abstained"] is False


class TestOneRerankPerQuestion:
    """Sub-queries return fused RRF candidates; only the merged pool is reranked.

    Runs the real `retrieve_all` -> `retrieve_ranked` -> `rerank_passages`
    chain and counts reranker HTTP calls. On prod 2026-09-28 every sub-query
    was reranked (3 in flight) on a reranker that scores one request at a
    time, and every /answer in that window fell back to RRF.
    """

    @pytest.mark.asyncio
    async def test_exactly_one_rerank_call(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from src.core import ranked
        from src.core.schemas import SearchResult

        monkeypatch.setattr(settings, "reranker_url", "http://reranker:8002")
        searched: list[str] = []

        async def hybrid(query: str, *_: Any, **__: Any) -> SearchResult:
            searched.append(query)
            base = 100 * len(searched)
            return SearchResult(passages=[
                _passage(base + i, S1_TEXT).model_copy(
                    update={"rerank_score": None, "score": 0.03 - i * 0.001}
                )
                for i in range(1, 16)
            ])

        reranked: list[tuple[str, int]] = []

        async def call(url: str, query: str, passages: list[Passage]) -> list[Passage]:
            reranked.append((query, len(passages)))
            return [p.model_copy(update={"rerank_score": 0.9}) for p in passages]

        question = "What is psychological incapacity?"
        with (
            patch.object(ranked, "embed_query", AsyncMock(return_value=None)),
            patch.object(ranked, "hybrid_retrieve", hybrid),
            patch("src.core.reranking._call_reranker", call),
            patch.object(service, "fetch_pinpoint_passages", AsyncMock(return_value=[])),
            patch.object(service, "generate_completion_with_usage", _llm()),
            patch.object(service, "lookup_section_metadata", AsyncMock(return_value={})),
        ):
            req = DeepResearchRequest(question=question, run_id="run-1")
            events = [event async for event in run_deep_research(req)]

        # The question and its three sub-queries were all searched...
        assert len(searched) == 1 + len(PLAN["sub_queries"])
        # ...and exactly one rerank went out: the merged pool, against the question.
        assert len(reranked) == 1
        assert reranked[0][0] == question
        assert reranked[0][1] <= settings.deep_research_max_candidates
        assert [e for e, _ in events][-1] == "done"


class TestFilterCitations:
    LABELLED = [LabelledPassage(label="S1", passage=PASSAGES[0])]

    def _one(self, citation: Citation) -> list[Citation]:
        draft = Draft(summary="", sections=[Section("h", [Claim("t", [citation])])])
        filtered, _dropped = filter_citations(draft, self.LABELLED)
        return filtered.sections[0].claims[0].citations

    def test_lowercase_label_normalised(self) -> None:
        assert self._one(Citation("s1", "a legal concept, not a medical"))[0].source_id == "S1"

    def test_empty_and_single_word_quotes_rejected(self) -> None:
        assert self._one(Citation("S1", "")) == []
        assert self._one(Citation("S1", "legal")) == []

    def test_overlong_quote_not_in_passage_rejected(self) -> None:
        assert self._one(Citation("S1", " ".join(["concept"] * 51))) == []

    def test_delivers_the_passage_span_not_the_writers_text(self) -> None:
        kept = self._one(Citation("S1", "IS A LEGAL CONCEPT, not a medical illness."))
        assert kept[0].quote == "is a legal concept, not a medical illness"

    def test_label_shaped_but_absent(self) -> None:
        assert self._one(Citation("S2", "a legal concept, not a medical")) == []


class TestMatchQuote:
    """Faithful quotes that failed the strict substring test on the prod gate
    (2026-09-29), plus the paraphrase that must still be refused."""

    @staticmethod
    def _delivered(quote: str, passage: str) -> str:
        span = match_quote(quote, passage)
        assert span is not None
        for fragment in span.split(" … "):
            assert fragment in passage
        return span

    def test_trailing_period_where_passage_continues(self) -> None:
        passage = (
            "The notice shall be served upon the employer , except when the employer is absent."
        )
        assert self._delivered("shall be served upon the employer.", passage) == (
            "shall be served upon the employer"
        )

    @pytest.mark.parametrize("ellipsis", ["...", "…"])
    def test_ellipsis_joins_two_fragments(self, ellipsis: str) -> None:
        passage = (
            "The penalty shall be imposed in its maximum period when the offender "
            "acted with treachery, and in its minimum period in all other cases."
        )
        quote = f"shall be imposed in its maximum period {ellipsis} in its minimum period"
        assert self._delivered(quote, passage) == (
            "shall be imposed in its maximum period … in its minimum period"
        )

    def test_fragments_out_of_order_rejected(self) -> None:
        passage = "first comes the lead clause, then comes the second clause entirely."
        assert match_quote("the second clause entirely ... first comes the lead", passage) is None

    def test_lead_in_joined_to_list_item(self) -> None:
        passage = (
            "The benefit of this Article shall be extended to those: who are first "
            "offenders; and (a) sentenced to a penalty not exceeding six years."
        )
        span = self._delivered(
            "extended to those: (a) sentenced to a penalty not exceeding six years", passage
        )
        assert span == (
            "extended to those … sentenced to a penalty not exceeding six years"
        )

    def test_case_difference(self) -> None:
        passage = "Psychological Incapacity Is A Legal Concept under the Family Code."
        assert self._delivered("psychological incapacity is a legal concept", passage) == (
            "Psychological Incapacity Is A Legal Concept"
        )

    def test_corpus_spacing_before_punctuation(self) -> None:
        passage = "The act must be of such gravity , i.e. , it must be serious ( not trivial ) ."
        assert self._delivered("of such gravity, i.e., it must be serious", passage) == (
            "of such gravity , i.e. , it must be serious"
        )

    def test_curly_quotes_and_dashes(self) -> None:
        passage = "the so-called “doctrine of necessity” — a narrow exception"
        assert self._delivered('so-called "doctrine of necessity" - a narrow', passage) == (
            "so-called “doctrine of necessity” — a narrow"
        )

    def test_statute_provision_over_limit_truncated(self) -> None:
        words = [f"w{i}" for i in range(45)]
        passage = "Section 5. " + " ".join(words) + " end."
        quote = " ".join(words)
        span = self._delivered(quote, passage)
        assert span == " ".join(words[:MAX_QUOTE_WORDS])
        long_words = [f"w{i}" for i in range(MAX_QUOTE_WORDS + 10)]
        span = self._delivered(" ".join(long_words), " ".join(long_words))
        assert span.split() == long_words[:MAX_QUOTE_WORDS]

    def test_overlong_quote_kept_by_filter_citations(self) -> None:
        words = [f"w{i}" for i in range(45)]
        passage = _passage(9, " ".join(words))
        draft = Draft(summary="", sections=[
            Section("h", [Claim("t", [Citation("S1", " ".join(words))])]),
        ])
        filtered, dropped = filter_citations(
            draft, [LabelledPassage(label="S1", passage=passage)]
        )
        assert filtered.sections[0].claims[0].citations[0].quote == " ".join(words)
        assert sum(dropped.values()) == 0

    def test_paraphrase_rejected(self) -> None:
        quote = (
            "it must be shown to be incapable of doing so due to some psychological illness"
        )
        assert match_quote(quote, S1_TEXT) is None
        claim = Claim("t", [Citation("S1", quote)])
        draft = Draft(summary="", sections=[Section("h", [claim])])
        filtered, dropped = filter_citations(
            draft, [LabelledPassage(label="S1", passage=PASSAGES[0])]
        )
        assert filtered.sections[0].claims[0].citations == []
        assert dropped == Counter({"quote_not_found": 1})


class TestRemovalReasons:
    """verify_draft counts WHY each thing was removed; behaviour is unchanged.

    Citation-level reasons (bad_label, quote_length, quote_not_found) count
    dropped citations; claim-level reasons (no_citations_left,
    verifier_unsupported, verifier_no_verdict) count removed claims.
    """

    ZERO = {
        "bad_label": 0, "quote_not_found": 0, "quote_length": 0,
        "no_citations_left": 0, "verifier_unsupported": 0, "verifier_no_verdict": 0,
    }

    async def _reasons(
        self,
        claims: list[dict[str, Any]],
        verifier: dict[str, Any] | None = None,
    ) -> tuple[dict[str, int], dict[str, Any]]:
        events = await _collect(_llm(writer=_writer_answer(claims), verifier=verifier))
        return _named(events, "done")["removalReasons"], _named(events, "result")

    def _expect(self, **counts: int) -> dict[str, int]:
        return {**self.ZERO, **counts}

    @pytest.mark.asyncio
    async def test_bad_label(self) -> None:
        claim = {"text": "t", "citations": [{"source_id": "S9", "quote": "a legal concept"}]}
        reasons, result = await self._reasons([GOOD_CLAIM, claim])
        assert reasons == self._expect(bad_label=1, no_citations_left=1)
        assert result["removedClaims"] == 1

    @pytest.mark.asyncio
    async def test_quote_not_found(self) -> None:
        claim = {"text": "t", "citations": [{"source_id": "S1", "quote": "never said this"}]}
        reasons, result = await self._reasons([GOOD_CLAIM, claim])
        assert reasons == self._expect(quote_not_found=1, no_citations_left=1)
        assert result["removedClaims"] == 1

    @pytest.mark.parametrize("quote", ["legal", ""])
    @pytest.mark.asyncio
    async def test_quote_length(self, quote: str) -> None:
        claim = {"text": "t", "citations": [{"source_id": "S1", "quote": quote}]}
        reasons, result = await self._reasons([GOOD_CLAIM, claim])
        assert reasons == self._expect(quote_length=1, no_citations_left=1)
        assert result["removedClaims"] == 1

    @pytest.mark.asyncio
    async def test_no_citations_left(self) -> None:
        claim = {"text": "An uncited proposition.", "citations": []}
        reasons, result = await self._reasons([GOOD_CLAIM, claim])
        assert reasons == self._expect(no_citations_left=1)
        assert result["removedClaims"] == 1

    @pytest.mark.asyncio
    async def test_verifier_unsupported(self) -> None:
        verdicts = {"summary_supported": True, "verdicts": {"C1": True, "C2": False}}
        reasons, result = await self._reasons([GOOD_CLAIM, GOOD_CLAIM], verifier=verdicts)
        assert reasons == self._expect(verifier_unsupported=1)
        assert result["removedClaims"] == 1

    @pytest.mark.asyncio
    async def test_verifier_no_verdict(self) -> None:
        verdicts = {"summary_supported": True, "verdicts": {"C1": True}}
        reasons, result = await self._reasons([GOOD_CLAIM, GOOD_CLAIM], verifier=verdicts)
        assert reasons == self._expect(verifier_no_verdict=1)
        assert result["removedClaims"] == 1

    @pytest.mark.asyncio
    async def test_verdicts_object_keeps_every_supported_claim(self) -> None:
        verdicts = {"summary_supported": True, "verdicts": {"C1": True, "c2": True, "C3": True}}
        reasons, result = await self._reasons([GOOD_CLAIM] * 3, verifier=verdicts)
        assert reasons == self._expect()
        assert result["removedClaims"] == 0
        assert len(_claims(result)) == 3

    @pytest.mark.asyncio
    async def test_legacy_verdicts_array_fails_closed(self) -> None:
        verdicts = {"summary_supported": True,
                    "verdicts": [{"claim_id": "C1", "supported": True}]}
        reasons, result = await self._reasons([GOOD_CLAIM], verifier=verdicts)
        assert reasons == self._expect(verifier_no_verdict=1)
        assert result["abstainReason"] == "validation_failed"

    @pytest.mark.asyncio
    async def test_verifier_schema_requires_every_claim_id(self) -> None:
        llm = _llm(writer=_writer_answer([GOOD_CLAIM] * 3))
        await _collect(llm)
        (call,) = [c for c in llm.await_args_list
                   if c.kwargs["system_prompt"] == VERIFIER_SYSTEM_PROMPT]
        schema = call.kwargs["response_format"]["json_schema"]
        assert schema["strict"] is True
        verdicts = schema["schema"]["properties"]["verdicts"]
        assert verdicts["type"] == "object"
        assert verdicts["additionalProperties"] is False
        assert verdicts["required"] == ["C1", "C2", "C3"]
        assert verdicts["properties"] == {cid: {"type": "boolean"} for cid in ("C1", "C2", "C3")}


    @pytest.mark.asyncio
    async def test_dropped_citation_on_a_kept_claim_is_counted_but_removes_nothing(
        self,
    ) -> None:
        claim = {
            "text": GOOD_CLAIM["text"],
            "citations": [*GOOD_CLAIM["citations"], {"source_id": "S7", "quote": "x y"}],
        }
        reasons, result = await self._reasons([claim])
        assert reasons == self._expect(bad_label=1)
        assert result["removedClaims"] == 0
        assert result["abstained"] is False

    @pytest.mark.asyncio
    async def test_everything_removed_still_abstains_validation_failed(self) -> None:
        verdicts = {
            "summary_supported": False,
            "verdicts": {"C1": False},
        }
        reasons, result = await self._reasons([GOOD_CLAIM], verifier=verdicts)
        assert reasons == self._expect(verifier_unsupported=1)
        assert result["abstainReason"] == "validation_failed"
        assert result["removedClaims"] == 1

    @pytest.mark.asyncio
    async def test_no_verification_means_empty_reasons(self) -> None:
        events = await _collect(_llm(), passages=PASSAGES[:1])  # too few: abstains early
        assert _named(events, "done")["removalReasons"] == {}

    @pytest.mark.asyncio
    async def test_one_log_line_per_run(self, caplog: pytest.LogCaptureFixture) -> None:
        claim = {"text": "t", "citations": [{"source_id": "S9", "quote": "a legal concept"}]}
        with caplog.at_level("INFO", logger=service.logger.name):
            await self._reasons([GOOD_CLAIM, claim])
        lines = [r.getMessage() for r in caplog.records if "verified" in r.getMessage()]
        assert lines == [
            "Deep research verified: kept=1 removed=1 reasons="
            + json.dumps(self._expect(bad_label=1, no_citations_left=1), sort_keys=True)
        ]

    def test_filter_citations_returns_counter_per_reason(self) -> None:
        labelled = [LabelledPassage(label="S1", passage=PASSAGES[0])]
        draft = Draft(summary="", sections=[Section("h", [Claim("t", [
            Citation("S1", "a legal concept, not a medical"),  # kept
            Citation("S1", "a legal concept, not a medical"),  # duplicate: not counted
            Citation("S4", "a legal concept"),
            Citation("banana", "a legal concept"),
            Citation("S1", "legal"),
            Citation("S1", "not in the passage"),
        ])])])
        filtered, dropped = filter_citations(draft, labelled)
        assert len(filtered.sections[0].claims[0].citations) == 1
        assert dropped == Counter({"bad_label": 2, "quote_length": 1, "quote_not_found": 1})


def test_extract_gr_no() -> None:
    assert extract_gr_no("G.R. No. 196359, May 11, 2021") == "G.R. No. 196359"
    assert extract_gr_no("", "GR No. L-63915") == "G.R. No. L-63915"
    assert extract_gr_no("Exec. Order No. 209") is None


# ---------------------------------------------------------------------------
# Router: SSE framing, auth and the model allowlist
# ---------------------------------------------------------------------------


def test_format_sse_is_one_line_of_json() -> None:
    frame = format_sse("stage", {"stage": "planning", "detail": "a\nb"})
    assert frame == 'event: stage\ndata: {"stage": "planning", "detail": "a\\nb"}\n\n'


class TestRouter:
    async def _post(self, body: dict[str, Any]) -> tuple[int, str]:
        from src.main import app

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
            response = await client.post("/research/deep", json=body)
            return response.status_code, response.text

    @pytest.mark.asyncio
    async def test_streams_events(self) -> None:
        async def fake_run(_: DeepResearchRequest) -> Any:
            yield ("stage", {"stage": "planning"})
            yield ("error", {"code": "internal", "message": "m"})

        with patch("src.deep_research.router.run_deep_research", fake_run):
            status, text = await self._post({"question": "Q?"})
        assert status == 200
        assert text == (
            'event: stage\ndata: {"stage": "planning"}\n\n'
            'event: error\ndata: {"code": "internal", "message": "m"}\n\n'
        )

    @pytest.mark.asyncio
    async def test_unlisted_model_override_is_422(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "deep_research_model_allowlist", "gpt-6-luna")
        status, _ = await self._post({"question": "Q?", "model_override": "gpt-4o"})
        assert status == 422

    @pytest.mark.asyncio
    async def test_wrong_scope_is_422(self) -> None:
        status, _ = await self._post({"question": "Q?", "scope": "ai_answer"})
        assert status == 422

    @pytest.mark.asyncio
    async def test_internal_key_required(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "internal_api_key", "k")
        status, _ = await self._post({"question": "Q?"})
        assert status == 403


# ---------------------------------------------------------------------------
# core/generation: reasoning-model parameters, json_schema, pricing
# ---------------------------------------------------------------------------


class TestGenerationModelParams:
    async def _call(self, model: str, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
        monkeypatch.setattr(settings, "openai_api_key", "sk-test")
        captured: dict[str, Any] = {}

        class Usage:
            prompt_tokens = 10
            completion_tokens = 5

        class Message:
            content = "{}"

        class Choice:
            message = Message()

        class Resp:
            choices = [Choice()]
            usage = Usage()
            model = "gpt-6-luna-2026-05-01"

        async def fake_create(_client: Any, **kwargs: Any) -> Resp:
            captured.update(kwargs)
            return Resp()

        monkeypatch.setattr(generation, "_openai_create", fake_create)
        monkeypatch.setattr(generation, "_get_openai_client", lambda: object())
        monkeypatch.setattr(generation, "_check_budget", AsyncMock())
        monkeypatch.setattr(generation, "_track_usage", AsyncMock())
        result = await generation.generate_completion_with_usage(
            "sys", "user", max_tokens=321, temperature=0.3,
            response_format={"type": "json_schema", "json_schema": {"name": "x"}},
            scope="ai_research", model=model,
        )
        captured["_result"] = result
        return captured

    @pytest.mark.asyncio
    async def test_gpt6_uses_reasoning_params(self, monkeypatch: pytest.MonkeyPatch) -> None:
        sent = await self._call("gpt-6-luna", monkeypatch)
        assert sent["model"] == "gpt-6-luna"
        assert sent["max_completion_tokens"] == 321
        assert sent["reasoning_effort"] == "low"
        assert "max_tokens" not in sent and "temperature" not in sent
        assert sent["response_format"] == {"type": "json_schema", "json_schema": {"name": "x"}}
        assert sent["_result"]["model_version"] == "gpt-6-luna-2026-05-01"

    @pytest.mark.asyncio
    async def test_gpt5_uses_reasoning_params(self, monkeypatch: pytest.MonkeyPatch) -> None:
        sent = await self._call("gpt-5-mini", monkeypatch)
        assert sent["max_completion_tokens"] == 321 and sent["reasoning_effort"] == "low"

    @pytest.mark.asyncio
    async def test_gpt4_keeps_classic_params(self, monkeypatch: pytest.MonkeyPatch) -> None:
        sent = await self._call("gpt-4o-mini", monkeypatch)
        assert sent["max_tokens"] == 321 and sent["temperature"] == 0.3
        assert "reasoning_effort" not in sent and "max_completion_tokens" not in sent

    def test_gpt6_luna_priced(self) -> None:
        assert generation.MODEL_PRICING["gpt-6-luna"] == (0.10, 0.50)
        assert generation.compute_cost_usd("gpt-6-luna", 1_000_000, 1_000_000) == pytest.approx(0.6)
        assert generation.compute_cost_usd("unknown", 10, 10) == 0.0


def test_verifier_response_format_is_built_per_call() -> None:
    fmt = verifier_response_format(["C1", "C2"])
    verdicts = fmt["json_schema"]["schema"]["properties"]["verdicts"]
    assert verdicts["required"] == ["C1", "C2"]
    assert set(verdicts["properties"]) == {"C1", "C2"}
    assert '"verdicts": {"C1": true|false' in VERIFIER_SYSTEM_PROMPT


def test_prompt_template_version() -> None:
    assert PROMPT_TEMPLATE_VERSION == "deep-research-v4"
