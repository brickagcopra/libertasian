"""The OpenSearch field contract between this service and the index mappings.

This file exists because of a specific failure. `_knn_search` queried
``knn: {"embedding": ...}``; the vector index's knn_vector field is
``embedding_vector``. Proved against the live prod cluster on 2026-08-14 with a
vector pulled from the index itself: ``embedding`` returns HTTP 400 "all shards
failed", ``embedding_vector`` returns correct neighbours. Two sibling bugs rode
along — both search functions asked for ``source_authority_level`` (the real
field is ``source_trust_level``, so the authority boost multiplied every passage
by 1.0 and reordered nothing, on the BM25 leg that IS live) and `_knn_search`
asked the vector index for ``plain_text`` (it maps ``text_snippet``, so kNN
passages would have had empty bodies even once the query worked).

The existing unit test asserted ``query["knn"]["embedding"]`` — it encoded the
bug and passed happily. So these tests do not assert what the code does; they
assert the code agrees with `apps/api/src/modules/search/index-mappings.ts`,
which is the single source of truth for both mappings and is what production
actually builds its indices from.

Why nothing else catches this: the mappings are ``dynamic: 'strict'``, so a bad
WRITE fails loudly. A bad READ does not. A ``_source`` naming a field that does
not exist is simply omitted from the response, and a ``knn`` clause naming one
is a 400 that the caller is allowed to swallow.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from src.core.retrieval import (
    _DOC_SOURCE_FIELDS,
    _KEYWORD_INDEX_FIELDS,
    _KEYWORD_SOURCE_FIELDS,
    _VECTOR_EMBEDDING_FIELD,
    _VECTOR_INDEX_FIELDS,
    _VECTOR_SOURCE_FIELDS,
    _bm25_search,
    _knn_search,
    retrieve_by_document_id,
    retrieve_by_query,
)
from src.core.types import QueryIntent

# services/rag-service/tests/ -> repo root
_REPO_ROOT = Path(__file__).resolve().parents[3]
_MAPPINGS_TS = _REPO_ROOT / "apps/api/src/modules/search/index-mappings.ts"


# ---------------------------------------------------------------------------
# Minimal TypeScript mapping reader
# ---------------------------------------------------------------------------


def _strip_comments(source: str) -> str:
    """Remove // and /* */ comments so prose cannot be read as a field name."""
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", source)


def _properties_block(source: str, func_name: str) -> str:
    """Return the body of the `properties: { ... }` object inside `func_name`."""
    fn_at = source.index(f"export function {func_name}")
    props_at = source.index("properties:", fn_at)
    open_at = source.index("{", props_at)

    depth = 0
    for i in range(open_at, len(source)):
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
            if depth == 0:
                return source[open_at + 1 : i]
    raise AssertionError(f"unbalanced braces in {func_name}")


def _mapped_fields(func_name: str) -> set[str]:
    """Top-level field names declared by an index mapping builder in the TS file."""
    block = _properties_block(_strip_comments(_MAPPINGS_TS.read_text()), func_name)

    fields: set[str] = set()
    depth = 0
    for match in re.finditer(r"[{}]|([A-Za-z_][A-Za-z0-9_]*)\s*:", block):
        token = match.group(0)
        if token == "{":
            depth += 1
        elif token == "}":
            depth -= 1
        elif depth == 0 and match.group(1):
            fields.add(match.group(1))
    return fields


# ---------------------------------------------------------------------------
# Query-body capture
# ---------------------------------------------------------------------------


async def _capture(coro_factory: Any) -> tuple[str, dict[str, Any]]:
    """Run a search function against a stub and return (index, request body)."""
    seen: dict[str, Any] = {}

    async def _stub(index: str, body: dict[str, Any]) -> dict[str, Any]:
        seen["index"] = index
        seen["body"] = body
        return {"hits": {"hits": []}}

    with patch("src.core.retrieval.opensearch_search", side_effect=_stub):
        await coro_factory()

    return seen["index"], seen["body"]


# ---------------------------------------------------------------------------
# The Python field sets must match the TypeScript mappings
# ---------------------------------------------------------------------------


class TestPythonMatchesTsMapping:
    """`index-mappings.ts` is what prod builds its indices from. We mirror it."""

    def test_mappings_file_is_readable(self) -> None:
        """A moved or renamed TS file must fail loudly, not skip the contract."""
        assert _MAPPINGS_TS.is_file(), f"index mappings not found at {_MAPPINGS_TS}"

    def test_reader_finds_a_known_field(self) -> None:
        """Guard the parser itself: a reader returning {} would pass everything."""
        keyword = _mapped_fields("buildKeywordIndexMapping")
        vector = _mapped_fields("buildVectorIndexMapping")

        assert "plain_text" in keyword
        assert len(keyword) > 20
        assert _VECTOR_EMBEDDING_FIELD in vector
        assert len(vector) > 10
        # The parser must not mistake a nested option (`type`, `analyzer`,
        # `dimension`) for a top-level field name.
        assert "type" not in keyword
        assert "analyzer" not in keyword
        assert "dimension" not in vector

    def test_keyword_field_set_matches(self) -> None:
        assert _mapped_fields("buildKeywordIndexMapping") == _KEYWORD_INDEX_FIELDS

    def test_vector_field_set_matches(self) -> None:
        assert _mapped_fields("buildVectorIndexMapping") == _VECTOR_INDEX_FIELDS

    def test_vector_index_has_no_plain_text(self) -> None:
        """The exact confusion behind the empty-body half of the bug."""
        vector = _mapped_fields("buildVectorIndexMapping")
        assert "plain_text" not in vector
        assert "text_snippet" in vector

    def test_neither_index_maps_authority(self) -> None:
        """`source_authority_level` is our Passage field name, never an index field."""
        assert "source_authority_level" not in _mapped_fields("buildKeywordIndexMapping")
        assert "source_authority_level" not in _mapped_fields("buildVectorIndexMapping")


# ---------------------------------------------------------------------------
# Every field the queries actually send must exist in the target index
# ---------------------------------------------------------------------------


class TestKnnQueryFields:
    """The kNN leg. This is the test that would have caught the outage."""

    @pytest.mark.asyncio
    async def test_knn_field_exists_in_mapping(self) -> None:
        index, body = await _capture(lambda: _knn_search([0.1] * 384, top_k=5))

        knn_clause = body["query"]["knn"]
        assert len(knn_clause) == 1, "exactly one knn_vector field per query"
        field = next(iter(knn_clause))

        assert field == _VECTOR_EMBEDDING_FIELD
        assert field in _mapped_fields("buildVectorIndexMapping")
        assert index == "legal_documents_vector"

    @pytest.mark.asyncio
    async def test_knn_source_fields_exist(self) -> None:
        _index, body = await _capture(lambda: _knn_search([0.1] * 384, top_k=5))

        unmapped = set(body["_source"]) - _mapped_fields("buildVectorIndexMapping")
        assert not unmapped, f"vector index does not map: {sorted(unmapped)}"

    @pytest.mark.asyncio
    async def test_knn_requests_a_body_field(self) -> None:
        """Field names can all be valid and still return textless passages."""
        _index, body = await _capture(lambda: _knn_search([0.1] * 384, top_k=5))

        assert "text_snippet" in body["_source"]

    @pytest.mark.asyncio
    async def test_knn_hit_reads_text_snippet(self) -> None:
        """The `_source` list and the hit reader must name the same body field."""
        hit = {
            "_id": "v1",
            "_score": 0.9,
            "_source": {"document_id": "d1", "text_snippet": "vector body text"},
        }

        async def _stub(_index: str, _body: dict[str, Any]) -> dict[str, Any]:
            return {"hits": {"hits": [hit]}}

        with patch("src.core.retrieval.opensearch_search", side_effect=_stub):
            results = await _knn_search([0.1] * 384)

        assert results[0]["text"] == "vector body text"

    @pytest.mark.asyncio
    async def test_knn_hit_reads_trust_level(self) -> None:
        hit = {
            "_id": "v1",
            "_score": 0.9,
            "_source": {"document_id": "d1", "source_trust_level": "official"},
        }

        async def _stub(_index: str, _body: dict[str, Any]) -> dict[str, Any]:
            return {"hits": {"hits": [hit]}}

        with patch("src.core.retrieval.opensearch_search", side_effect=_stub):
            results = await _knn_search([0.1] * 384)

        assert results[0]["source_authority_level"] == "official"


class TestBm25QueryFields:
    """The BM25 leg — same defect class, and it carried one of its own."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("intent", list(QueryIntent))
    async def test_source_fields_exist(self, intent: QueryIntent) -> None:
        index, body = await _capture(lambda: _bm25_search("estafa", intent, top_k=5))

        unmapped = set(body["_source"]) - _mapped_fields("buildKeywordIndexMapping")
        assert not unmapped, f"keyword index does not map: {sorted(unmapped)}"
        assert index == "legal_documents_keyword"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("intent", list(QueryIntent))
    async def test_searched_fields_exist(self, intent: QueryIntent) -> None:
        """Boosted `multi_match` fields are silently ignored if unmapped too."""
        _index, body = await _capture(lambda: _bm25_search("estafa", intent, top_k=5))

        query = body["query"]
        inner = query["bool"]["must"][0] if "bool" in query else query
        searched = {f.split("^")[0] for f in inner["multi_match"]["fields"]}

        unmapped = searched - _mapped_fields("buildKeywordIndexMapping")
        assert not unmapped, f"keyword index does not map: {sorted(unmapped)}"

    @pytest.mark.asyncio
    async def test_bm25_hit_reads_trust_level(self) -> None:
        """The bug that silently disabled the authority boost on every hit."""
        hit = {
            "_id": "k1",
            "_score": 5.0,
            "_source": {"document_id": "d1", "source_trust_level": "official"},
        }

        async def _stub(_index: str, _body: dict[str, Any]) -> dict[str, Any]:
            return {"hits": {"hits": [hit]}}

        with patch("src.core.retrieval.opensearch_search", side_effect=_stub):
            results = await _bm25_search("estafa", QueryIntent.GENERAL)

        assert results[0]["source_authority_level"] == "official"


class TestDocumentQueryFields:
    """`_DOC_SOURCE_FIELDS` feeds memos, flashcards, pleadings, comparisons…"""

    @pytest.mark.asyncio
    async def test_by_document_id_fields_exist(self) -> None:
        _index, body = await _capture(lambda: retrieve_by_document_id("doc-1"))

        unmapped = set(body["_source"]) - _mapped_fields("buildKeywordIndexMapping")
        assert not unmapped, f"keyword index does not map: {sorted(unmapped)}"

    @pytest.mark.asyncio
    async def test_by_query_fields_exist(self) -> None:
        _index, body = await _capture(lambda: retrieve_by_query("estafa"))

        unmapped = set(body["_source"]) - _mapped_fields("buildKeywordIndexMapping")
        assert not unmapped, f"keyword index does not map: {sorted(unmapped)}"

    def test_doc_fields_are_keyword_fields(self) -> None:
        assert set(_DOC_SOURCE_FIELDS) <= _KEYWORD_INDEX_FIELDS


class TestSourceListConstants:
    """Belt and braces: the constants alone, with no query execution."""

    def test_keyword_source_list_is_mapped(self) -> None:
        assert set(_KEYWORD_SOURCE_FIELDS) <= _KEYWORD_INDEX_FIELDS

    def test_vector_source_list_is_mapped(self) -> None:
        assert set(_VECTOR_SOURCE_FIELDS) <= _VECTOR_INDEX_FIELDS

    def test_no_source_list_names_plain_text(self) -> None:
        """The vector index has no such field; asking for it yields empty text."""
        assert "plain_text" not in _VECTOR_SOURCE_FIELDS

    def test_both_lists_carry_a_body_field(self) -> None:
        assert "plain_text" in _KEYWORD_SOURCE_FIELDS
        assert "text_snippet" in _VECTOR_SOURCE_FIELDS
