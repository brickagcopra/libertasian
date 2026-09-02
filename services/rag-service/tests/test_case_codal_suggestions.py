"""Guard: the codal-candidate filter names document_type values the corpus has.

Same class of bug as the CODAL_REFERENCE boost in `core/retrieval.py` — a
`terms` filter listing a value that does not exist in `legal_documents_keyword`
is silently narrower than it reads. Here it was load-bearing: the list carried
"statute" (zero documents) but not "constitution", so `_search_codal_candidates`
could never return a provision of the 1987 Constitution, and no codal
suggestion for it was reachable.

The vocabulary below was measured from a live terms aggregation on prod on
2026-09-02. It is pinned here rather than imported from the source so this file
is an independent statement about the corpus: the test exists to FAIL if
someone reintroduces a value the corpus does not have.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from src.citations.case_codal_suggestions import _search_codal_candidates

# Proven absent from `legal_documents_keyword` on that run. This is the
# assertion the test can make honestly: "administrative_order" is also in the
# filter and was not part of the 2026-09-02 aggregation, so it is neither
# vouched for here nor removed — re-measure it before relying on it.
_ABSENT_DOCUMENT_TYPES = frozenset({"statute", "code", "rule"})


async def _captured_document_types() -> list[str]:
    """Return the document_type values the codal candidate filter allows."""
    captured: dict[str, Any] = {}

    async def _capture_search(index: str, body: dict[str, Any]) -> dict[str, Any]:
        captured.update(body)
        return {"hits": {"hits": []}}

    with patch(
        "src.citations.case_codal_suggestions.opensearch_search",
        side_effect=_capture_search,
    ):
        await _search_codal_candidates("The accused was charged under Article 315.")

    filters = captured["query"]["bool"]["filter"]
    terms = [f["terms"]["document_type"] for f in filters if "terms" in f]
    assert len(terms) == 1
    return terms[0]


class TestCodalCandidateDocumentTypes:
    @pytest.mark.asyncio
    async def test_constitution_is_reachable(self) -> None:
        """Without it, a Constitution provision can never be suggested."""
        assert "constitution" in await _captured_document_types()

    @pytest.mark.asyncio
    async def test_filter_names_no_absent_type(self) -> None:
        doc_types = set(await _captured_document_types())

        assert not (doc_types & _ABSENT_DOCUMENT_TYPES)
