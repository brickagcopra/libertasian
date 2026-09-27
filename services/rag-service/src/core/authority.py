"""Source-authority boost applied to ranked passages.

Per CLAUDE.md, retrieval ranking prefers official sources over semi-official,
editorial and private ones, as a boost signal.

Two things were wrong with the boost this module replaces, and either one alone
was enough to make it a no-op:

* **The keys never matched.** It was keyed on ``official`` / ``semi_official`` /
  ``editorial`` / ``private``, but the index field it reads,
  ``source_trust_level``, holds ``Source.trustLevel`` — ``high`` / ``medium`` /
  ``low`` (``apps/api/src/modules/search/index-rebuild.service.ts`` and
  ``apps/api/prisma/seed-sources.ts``). Every passage missed the table and got
  the 1.0 default.
* **It ran before reranking.** It multiplied the RRF fusion score, and the
  cross-encoder then replaced the ordering with its own scores, so even a
  matching key could not have survived to the final order.

It now keys on the real values (keeping the old names as aliases, in case any
row or caller still carries them) and is applied to the score that decides the
final order: the cross-encoder score when the reranker ran, the RRF score when
it did not.

The boost only reorders. It never rewrites ``score`` or ``rerank_score``, so the
raw reranker score stays available for abstention — a boost that let a weak
official passage clear the abstention threshold would be answering from
authority rather than relevance.
"""

from __future__ import annotations

import logging
from collections import Counter
from collections.abc import Callable

from .schemas import Passage

logger = logging.getLogger(__name__)

# `Source.trustLevel` values as indexed in `source_trust_level`.
_TRUST_BOOST: dict[str, float] = {
    "high": 1.30,
    "medium": 1.15,
    "low": 1.00,
    "private": 0.90,
}

# Legacy authority names, kept as aliases of the trust level they correspond to.
_LEGACY_ALIASES: dict[str, str] = {
    "official": "high",
    "semi_official": "medium",
    "editorial": "low",
}

AUTHORITY_BOOST: dict[str, float] = {
    **_TRUST_BOOST,
    **{alias: _TRUST_BOOST[level] for alias, level in _LEGACY_ALIASES.items()},
}

# Anything that is not a recognised trust level. Deliberately the same as
# `private`: an unlabelled source has earned no authority lift.
UNKNOWN_BOOST = 0.90


def _normalise(level: str | None) -> str:
    return (level or "").strip().lower()


def authority_boost(level: str | None) -> float:
    """The boost multiplier for a ``source_trust_level`` value."""
    return AUTHORITY_BOOST.get(_normalise(level), UNKNOWN_BOOST)


def apply_authority_boost(
    passages: list[Passage],
    score_of: Callable[[Passage], float],
) -> list[Passage]:
    """Return ``passages`` ordered by ``score_of(p) * authority_boost(p)``.

    The sort is stable, so passages whose boosted scores tie keep the order they
    arrived in — for a uniform trust level the result is the input order.
    Passages are not modified.
    """
    if not passages:
        return []

    if logger.isEnabledFor(logging.DEBUG):
        counts = Counter(
            _normalise(p.source_authority_level) or "<empty>" for p in passages
        )
        logger.debug(
            "Authority boost over %d passage(s) by trust level: %s",
            len(passages),
            ", ".join(
                f"{level}={count} (x{authority_boost(level):.2f})"
                for level, count in sorted(counts.items())
            ),
        )

    return sorted(
        passages,
        key=lambda p: score_of(p) * authority_boost(p.source_authority_level),
        reverse=True,
    )
