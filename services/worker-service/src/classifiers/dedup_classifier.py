"""LIBERTASIAN Worker Service — 6-tier deduplication classifier.

Classifies incoming ingestion candidates into one of six tiers:
1. exact_duplicate      — Checksum match (confidence 1.0)
2. canonical_url_match  — Same canonical_url + different checksum (0.75, pending review)
3. mirror_duplicate     — Same GR No. + same citation from different source (0.90-0.95)
4. version_update       — Same GR No. + different checksum from same source (0.80-0.85)
5. possible_duplicate   — Title similarity >= threshold (0.65-0.70)
6. new_document         — No match above threshold

Behavior per tier:
- exact_duplicate / mirror_duplicate: skip ingestion, create DocumentSimilarity
- canonical_url_match: ingest AND create DocumentSimilarity (status='pending' → review).
  Mirror sites and Lawphil ↔ SC E-Library publish under the same URL but content
  diverges; reviewer must classify manually (merge / version_update / dismiss).
- version_update: create new LegalDocumentVersion, create DocumentSimilarity
- possible_duplicate: create document AND DocumentSimilarity (status='pending' → review)
- new_document: proceed with normal ingestion

Per plan: Levenshtein scoped to same source + same document_type to avoid O(n^2).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class DedupTier(str, Enum):
    """6-tier dedup classification."""

    EXACT_DUPLICATE = "exact_duplicate"
    CANONICAL_URL_MATCH = "canonical_url_match"
    MIRROR_DUPLICATE = "mirror_duplicate"
    VERSION_UPDATE = "version_update"
    POSSIBLE_DUPLICATE = "possible_duplicate"
    NEW_DOCUMENT = "new_document"


@dataclass
class DedupResult:
    """Result of dedup classification for a single candidate."""

    tier: DedupTier
    confidence: float
    matched_document_id: str | None = None
    matched_document_title: str | None = None
    evidence: dict[str, Any] = field(default_factory=dict)

    @property
    def should_skip_ingestion(self) -> bool:
        """Whether this candidate should be skipped (not ingested)."""
        return self.tier in (DedupTier.EXACT_DUPLICATE, DedupTier.MIRROR_DUPLICATE)

    @property
    def is_version_update(self) -> bool:
        """Whether this candidate is an update to an existing document."""
        return self.tier == DedupTier.VERSION_UPDATE

    @property
    def needs_review(self) -> bool:
        """Whether this candidate needs human review."""
        return self.tier in (
            DedupTier.POSSIBLE_DUPLICATE,
            DedupTier.CANONICAL_URL_MATCH,
        )


def _levenshtein_similarity(s1: str, s2: str) -> float:
    """Compute Levenshtein similarity ratio between two strings.

    Returns a float in [0.0, 1.0] where 1.0 = identical.
    Uses dynamic programming approach.
    """
    if s1 == s2:
        return 1.0

    len1, len2 = len(s1), len(s2)
    if len1 == 0 or len2 == 0:
        return 0.0

    # Create distance matrix
    matrix: list[list[int]] = [[0] * (len2 + 1) for _ in range(len1 + 1)]

    for i in range(len1 + 1):
        matrix[i][0] = i
    for j in range(len2 + 1):
        matrix[0][j] = j

    for i in range(1, len1 + 1):
        for j in range(1, len2 + 1):
            cost = 0 if s1[i - 1] == s2[j - 1] else 1
            matrix[i][j] = min(
                matrix[i - 1][j] + 1,      # deletion
                matrix[i][j - 1] + 1,      # insertion
                matrix[i - 1][j - 1] + cost,  # substitution
            )

    distance = matrix[len1][len2]
    max_len = max(len1, len2)
    return 1.0 - (distance / max_len)


def _normalize_title(title: str) -> str:
    """Normalize a title for comparison: lowercase, strip punctuation, collapse whitespace."""
    import re

    result = title.lower().strip()
    result = re.sub(r"[^\w\s]", "", result)
    result = re.sub(r"\s+", " ", result)
    return result


class DedupClassifier:
    """5-tier deduplication classifier for ingestion candidates.

    Uses a cascade of checks: checksum → GR No. cross-source → GR No. same-source
    → title similarity. First match wins.
    """

    def __init__(
        self,
        title_threshold: float = 0.85,
        title_high_threshold: float = 0.90,
    ) -> None:
        self.title_threshold = title_threshold
        self.title_high_threshold = title_high_threshold

    def classify(
        self,
        *,
        content_checksum: str,
        source_id: str,
        title: str,
        gr_no: str | None = None,
        citation_text: str | None = None,
        court: str | None = None,
        document_type: str | None = None,
        canonical_url: str | None = None,
        checksum_match: dict[str, Any] | None = None,
        canonical_url_match: dict[str, Any] | None = None,
        gr_no_same_source_match: dict[str, Any] | None = None,
        gr_no_cross_source_matches: list[dict[str, Any]] | None = None,
        title_candidates: list[dict[str, Any]] | None = None,
    ) -> DedupResult:
        """Classify a candidate document into one of 6 dedup tiers.

        Args:
            content_checksum: SHA-256 of the raw document content.
            source_id: Source this candidate was discovered from.
            title: Document title.
            gr_no: Normalized GR number (if any).
            citation_text: Normalized citation text (if any).
            court: Court name (if any).
            document_type: Document type (case, codal, etc).
            canonical_url: Candidate's canonical_url (if any).
            checksum_match: Existing document with same checksum (or None).
            canonical_url_match: Existing doc with same canonical_url +
                different checksum (or None). Fallback signal — checksum match
                wins, so callers should only set this when no checksum match.
            gr_no_same_source_match: Existing doc with same GR No. + same source.
            gr_no_cross_source_matches: Existing docs with same GR No. from other sources.
            title_candidates: Docs with similar titles (same source + doc type scope).

        Returns:
            DedupResult with tier, confidence, matched doc, and evidence.
        """
        # Tier 1: Exact duplicate (checksum match) — wins over everything,
        # including canonical_url. Mirror sites with stable URLs can still
        # serve byte-identical content; that path is auto-dismiss, not pending.
        if checksum_match:
            return DedupResult(
                tier=DedupTier.EXACT_DUPLICATE,
                confidence=1.0,
                matched_document_id=checksum_match["id"],
                matched_document_title=checksum_match.get("title"),
                evidence={
                    "method": "checksum",
                    "checksum": content_checksum,
                    "matched_source_id": checksum_match.get("source_id"),
                },
            )

        # Tier 2: Canonical URL match (same URL, different checksum) —
        # reviewer-gated. Lawphil ↔ SC E-Library publish under the same URL
        # but content can diverge (mirror site or version drift), so this
        # MUST stay pending — never auto-dismiss.
        if canonical_url and canonical_url_match:
            existing_checksum = canonical_url_match.get("checksum")
            if existing_checksum != content_checksum:
                return DedupResult(
                    tier=DedupTier.CANONICAL_URL_MATCH,
                    confidence=0.75,
                    matched_document_id=canonical_url_match["id"],
                    matched_document_title=canonical_url_match.get("title"),
                    evidence={
                        "method": "canonical_url",
                        "matched_on": "canonical_url",
                        "url": canonical_url,
                        "existing_checksum": existing_checksum,
                        "new_checksum": content_checksum,
                        "matched_source_id": canonical_url_match.get("source_id"),
                    },
                )

        # Tier 3: Mirror duplicate (same GR No. + same citation from different source)
        if gr_no and gr_no_cross_source_matches:
            for match in gr_no_cross_source_matches:
                match_citation = match.get("citation_text", "")
                confidence = 0.90

                if citation_text and match_citation:
                    if citation_text.lower() == match_citation.lower():
                        confidence = 0.95

                return DedupResult(
                    tier=DedupTier.MIRROR_DUPLICATE,
                    confidence=confidence,
                    matched_document_id=match["id"],
                    matched_document_title=match.get("title"),
                    evidence={
                        "method": "gr_no_cross_source",
                        "gr_no": gr_no,
                        "candidate_source": source_id,
                        "matched_source": match.get("source_id"),
                        "citation_match": citation_text and match_citation
                        and citation_text.lower() == match_citation.lower(),
                    },
                )

        # Tier 4: Version update (same GR No. + different checksum from same source)
        if gr_no and gr_no_same_source_match:
            existing_checksum = gr_no_same_source_match.get("checksum")
            if existing_checksum != content_checksum:
                confidence = 0.80
                # Higher confidence if document is newer (has promulgation_date)
                if gr_no_same_source_match.get("decision_date"):
                    confidence = 0.85

                return DedupResult(
                    tier=DedupTier.VERSION_UPDATE,
                    confidence=confidence,
                    matched_document_id=gr_no_same_source_match["id"],
                    matched_document_title=gr_no_same_source_match.get("title"),
                    evidence={
                        "method": "gr_no_same_source_version",
                        "gr_no": gr_no,
                        "existing_checksum": existing_checksum,
                        "new_checksum": content_checksum,
                        "existing_version": gr_no_same_source_match.get("version_no"),
                    },
                )

        # Tier 5: Possible duplicate (title similarity)
        if title_candidates:
            normalized_title = _normalize_title(title)
            best_match: dict[str, Any] | None = None
            best_similarity = 0.0

            for candidate_doc in title_candidates:
                candidate_title = _normalize_title(candidate_doc.get("title", ""))
                similarity = _levenshtein_similarity(normalized_title, candidate_title)

                if similarity > best_similarity:
                    best_similarity = similarity
                    best_match = candidate_doc

            if best_match and best_similarity >= self.title_threshold:
                # Higher confidence if title similarity is very high
                if best_similarity >= self.title_high_threshold:
                    confidence = 0.70
                else:
                    # Lower confidence for borderline matches, also check court
                    if court and best_match.get("court") == court:
                        confidence = 0.70
                    else:
                        confidence = 0.65

                return DedupResult(
                    tier=DedupTier.POSSIBLE_DUPLICATE,
                    confidence=confidence,
                    matched_document_id=best_match["id"],
                    matched_document_title=best_match.get("title"),
                    evidence={
                        "method": "title_similarity",
                        "similarity_score": round(best_similarity, 4),
                        "threshold": self.title_threshold,
                        "candidate_title": title,
                        "matched_title": best_match.get("title"),
                        "same_court": court == best_match.get("court")
                        if court
                        else None,
                    },
                )

        # Tier 6: New document
        return DedupResult(
            tier=DedupTier.NEW_DOCUMENT,
            confidence=0.0,
            evidence={"method": "no_match"},
        )
