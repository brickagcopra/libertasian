"""Deep Research focused passages (`src/deep_research/focus.py`)."""

from __future__ import annotations

import math
from unittest.mock import AsyncMock, patch

import pytest

from src.core.schemas import Passage
from src.deep_research import focus
from src.deep_research.focus import (
    WINDOW_CHARS,
    best_window,
    focus_passages,
    query_term_weights,
)

SECTION_ID = "0b6f5a4e-3c2d-4e1f-9a8b-7c6d5e4f3a2b"
QUERIES = [
    "What is the doctrine of psychological incapacity?",
    "psychological incapacity juridical antecedence gravity incurability",
    "Article 36 Family Code psychological incapacity",
]

FILLER = "The petitioner filed a motion for reconsideration which was denied. " * 60
MATCH = (
    "Psychological incapacity must be characterized by gravity, juridical antecedence "
    "and incurability under Article 36 of the Family Code. "
)
LONG_TEXT = FILLER + MATCH * 3 + FILLER


def _passage(text: str, section_id: str | None = SECTION_ID) -> Passage:
    return Passage(id="p1", document_id="d1", section_id=section_id, text=text)


def test_query_term_weights_count_queries_not_occurrences() -> None:
    weights = query_term_weights(QUERIES)
    assert weights["psychological"] == pytest.approx(1 + math.log(3))
    assert weights["incapacity"] == pytest.approx(1 + math.log(3))
    assert weights["gravity"] == pytest.approx(1.0)
    # stopwords and words under three characters are not terms
    assert "the" not in weights and "of" not in weights and "36" not in weights


def test_window_picks_the_matching_region_of_a_long_text() -> None:
    window = best_window(LONG_TEXT, query_term_weights(QUERIES))
    assert len(window) <= WINDOW_CHARS
    assert "juridical antecedence" in window
    assert LONG_TEXT.index(MATCH) > WINDOW_CHARS  # not simply the first slice
    # trimmed to a sentence start
    assert window[0].isupper()


def test_window_of_a_short_text_is_the_whole_text() -> None:
    text = "Psychological incapacity is a ground for nullity."
    assert best_window(text, query_term_weights(QUERIES)) == text


@pytest.mark.asyncio
async def test_long_section_passage_is_replaced_by_its_best_window() -> None:
    fetch = AsyncMock(return_value={SECTION_ID: LONG_TEXT})
    with patch.object(focus, "fetch_section_texts", fetch):
        (out,) = await focus_passages([_passage(LONG_TEXT[:2000])], QUERIES)
    fetch.assert_awaited_once_with([SECTION_ID])
    assert "juridical antecedence" in out.text
    assert out.id == "p1" and out.section_id == SECTION_ID


@pytest.mark.asyncio
async def test_short_section_text_leaves_the_passage_unchanged() -> None:
    passage = _passage("Psychological incapacity is a ground for nullity of marriage.")
    fetch = AsyncMock(return_value={SECTION_ID: "Psychological incapacity."})
    with patch.object(focus, "fetch_section_texts", fetch):
        (out,) = await focus_passages([passage], QUERIES)
    assert out == passage


@pytest.mark.asyncio
async def test_db_failure_keeps_the_pool_as_is() -> None:
    pool = [_passage(LONG_TEXT[:2000]), _passage("no section", section_id=None)]
    fetch = AsyncMock(side_effect=OSError("connection refused"))
    with patch.object(focus, "fetch_section_texts", fetch):
        out = await focus_passages(pool, QUERIES)
    assert out == pool


@pytest.mark.asyncio
async def test_no_uuid_sections_means_no_lookup() -> None:
    fetch = AsyncMock()
    pool = [_passage("x", section_id=None), _passage("y", section_id="sec-1")]
    with patch.object(focus, "fetch_section_texts", fetch):
        assert await focus_passages(pool, QUERIES) == pool
    fetch.assert_not_awaited()


@pytest.mark.asyncio
async def test_fetch_section_texts_is_one_parameterized_query() -> None:
    conn = AsyncMock()
    conn.fetch = AsyncMock(return_value=[{"id": SECTION_ID, "plain_text": "t"},
                                         {"id": "other", "plain_text": None}])

    class _Ctx:
        async def __aenter__(self) -> AsyncMock:
            return conn

        async def __aexit__(self, *exc: object) -> None:
            return None

    with patch.object(focus, "acquire_connection", lambda: _Ctx()):
        assert await focus.fetch_section_texts([SECTION_ID]) == {SECTION_ID: "t"}
    sql, param = conn.fetch.await_args.args
    assert "ANY($1::uuid[])" in sql and param == [SECTION_ID]


@pytest.mark.asyncio
async def test_pipeline_reranks_the_focused_text() -> None:
    from tests.test_deep_research import PASSAGES, _collect, _llm

    pool = [PASSAGES[0].model_copy(update={"section_id": SECTION_ID,
                                           "text": LONG_TEXT[:2000]}), *PASSAGES[1:]]
    mocks: dict[str, AsyncMock] = {}
    fetch = AsyncMock(return_value={SECTION_ID: LONG_TEXT})
    with patch.object(focus, "fetch_section_texts", fetch):
        await _collect(_llm(), passages=pool, mocks=mocks)
    reranked_pool = mocks["rerank"].await_args.args[1]
    focused = next(p for p in reranked_pool if p.section_id == SECTION_ID)
    assert "juridical antecedence" in focused.text
