"""Focused passages: show the writer the part of a section that answers the question.

An indexed passage is the first slice of its section, so for a long section
(a decision's discussion, a code article with many paragraphs) the part the
question is about is often not in the text the reranker and the writer see.
Before the one rerank, each pool passage that has a section is re-read from
PostgreSQL — the system of record — and, when the full section is longer than
the passage, its text is replaced by the ``WINDOW_CHARS`` window that best
matches the question and its sub-queries.

Window score: the sum, over the distinct query terms present in the window,
of ``1 + ln(number of queries containing that term)``, so a term every
sub-query shares outweighs one a single sub-query used. Terms are lowercased
alphanumeric runs with stopwords and words under three characters removed.

Deep Research only: /answer keeps `core.retrieval`'s passages unchanged.
Read-only and parameterized; any failure keeps the pool as it was.
"""

from __future__ import annotations

import logging
import math
import re
from collections import Counter
from collections.abc import Sequence

from ..core.retrieval import _ENGLISH_STOPWORDS
from ..core.schemas import Passage
from ..shared.database import acquire_connection
from ..shared.exceptions import SchemaIntegrityError

logger = logging.getLogger(__name__)

WINDOW_CHARS = 1900
WINDOW_STRIDE = 400
# A window is trimmed to the first sentence start inside this many chars.
SENTENCE_TRIM_CHARS = 300
_MIN_TERM_CHARS = 3

_TERM_RE = re.compile(r"[a-z0-9]+")
# A sentence starts after terminal punctuation and whitespace, at a capital,
# digit, quote or opening parenthesis.
_SENTENCE_START_RE = re.compile(r"[.!?;:]\s+(?=[A-Z0-9\"'(\[])")
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)


def terms(text: str) -> set[str]:
    return {
        t
        for t in _TERM_RE.findall(text.lower())
        if len(t) >= _MIN_TERM_CHARS and t not in _ENGLISH_STOPWORDS
    }


def query_term_weights(queries: Sequence[str]) -> dict[str, float]:
    """``{term: 1 + ln(number of queries containing it)}``."""
    counts: Counter[str] = Counter()
    for query in queries:
        counts.update(terms(query))
    return {term: 1.0 + math.log(n) for term, n in counts.items()}


def _window_starts(length: int) -> list[int]:
    last = max(length - WINDOW_CHARS, 0)
    starts = list(range(0, last + 1, WINDOW_STRIDE))
    if starts[-1] != last:
        starts.append(last)  # the tail is always a candidate
    return starts


def _trim_to_sentence(window: str) -> str:
    match = _SENTENCE_START_RE.search(window, 0, SENTENCE_TRIM_CHARS)
    return window[match.end():] if match else window


def best_window(text: str, weights: dict[str, float]) -> str:
    """The highest-scoring ``WINDOW_CHARS`` window of `text`; earliest wins ties."""
    best_start, best_score = 0, -1.0
    for start in _window_starts(len(text)):
        present = terms(text[start:start + WINDOW_CHARS])
        score = sum(weights[t] for t in present if t in weights)
        if score > best_score:
            best_start, best_score = start, score
    window = text[best_start:best_start + WINDOW_CHARS]
    return _trim_to_sentence(window) if best_start > 0 else window


async def fetch_section_texts(section_ids: Sequence[str]) -> dict[str, str]:
    """``{section_id: plain_text}`` in one parameterized query."""
    async with acquire_connection() as conn:
        rows = await conn.fetch(
            "SELECT s.id::text AS id, s.plain_text FROM legal_document_sections s "
            "WHERE s.id = ANY($1::uuid[])",
            list(section_ids),
        )
    return {str(row["id"]): str(row["plain_text"]) for row in rows if row["plain_text"]}


async def focus_passages(pool: Sequence[Passage], queries: Sequence[str]) -> list[Passage]:
    """Replace each section passage's text with its best-matching window.

    Best effort: a lookup failure returns the pool unchanged.
    """
    section_ids = sorted(
        {p.section_id for p in pool if p.section_id and _UUID_RE.match(p.section_id)}
    )
    if not section_ids:
        return list(pool)
    try:
        full_texts = await fetch_section_texts(section_ids)
    except SchemaIntegrityError:
        logger.exception("SchemaIntegrityError in deep research section text lookup")
        raise
    except Exception as exc:  # noqa: BLE001 - focusing is best effort
        logger.warning("Deep research section text lookup failed: %s", type(exc).__name__)
        return list(pool)

    weights = query_term_weights(queries)
    focused: list[Passage] = []
    for passage in pool:
        full = full_texts.get(passage.section_id) if passage.section_id else None
        if full is None or len(full) <= len(passage.text):
            focused.append(passage)
            continue
        focused.append(passage.model_copy(update={"text": best_window(full, weights)}))
    return focused
