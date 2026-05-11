"""Tests for the 6-tier dedup classifier.

Covers all 6 tiers:
1. exact_duplicate — checksum match
2. canonical_url_match — same canonical_url + different checksum (pending review)
3. mirror_duplicate — same GR No. + different source
4. version_update — same GR No. + same source + different checksum
5. possible_duplicate — title Levenshtein similarity >= threshold
6. new_document — no match
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from src.classifiers.dedup_classifier import (
    DedupClassifier,
    DedupResult,
    DedupTier,
    _levenshtein_similarity,
    _normalize_title,
)


def make_uuid() -> str:
    return str(uuid.uuid4())


# ─── Helper Tests ──────────────────────────────────────────────────────


class TestLevenshteinSimilarity:
    def test_identical_strings(self) -> None:
        assert _levenshtein_similarity("hello", "hello") == 1.0

    def test_completely_different(self) -> None:
        assert _levenshtein_similarity("abc", "xyz") == 0.0

    def test_one_character_difference(self) -> None:
        # "hello" vs "hallo" = 1 edit, max_len=5 → similarity = 1 - 1/5 = 0.8
        assert _levenshtein_similarity("hello", "hallo") == pytest.approx(0.8)

    def test_empty_strings(self) -> None:
        assert _levenshtein_similarity("", "") == 1.0

    def test_one_empty(self) -> None:
        assert _levenshtein_similarity("hello", "") == 0.0
        assert _levenshtein_similarity("", "hello") == 0.0

    def test_very_similar_titles(self) -> None:
        t1 = "republic of the philippines v sandiganbayan"
        t2 = "republic of the philippines vs sandiganbayan"
        sim = _levenshtein_similarity(t1, t2)
        assert sim > 0.95

    def test_symmetry(self) -> None:
        s1 = "people of the philippines v john doe"
        s2 = "people of the philippines v jane doe"
        assert _levenshtein_similarity(s1, s2) == _levenshtein_similarity(s2, s1)


class TestNormalizeTitle:
    def test_lowercase(self) -> None:
        assert _normalize_title("Republic v. Sandiganbayan") == "republic v sandiganbayan"

    def test_strip_punctuation(self) -> None:
        assert _normalize_title("G.R. No. 12345") == "gr no 12345"

    def test_collapse_whitespace(self) -> None:
        assert _normalize_title("  hello   world  ") == "hello world"


# ─── Tier Tests ────────────────────────────────────────────────────────


@pytest.fixture()
def classifier() -> DedupClassifier:
    return DedupClassifier(title_threshold=0.85, title_high_threshold=0.90)


@pytest.fixture()
def source_id() -> str:
    return make_uuid()


@pytest.fixture()
def other_source_id() -> str:
    return make_uuid()


@pytest.fixture()
def existing_doc(source_id: str) -> dict[str, Any]:
    return {
        "id": make_uuid(),
        "title": "Republic v. Sandiganbayan",
        "gr_no": "G.R. No. 123456",
        "citation_text": "G.R. No. 123456, January 15, 2024",
        "source_id": source_id,
        "checksum": "abc123def456",
        "court": "Supreme Court",
        "version_no": 1,
        "decision_date": "2024-01-15",
    }


class TestExactDuplicate:
    """Tier 1: exact_duplicate — checksum match."""

    def test_checksum_match_returns_exact_duplicate(
        self,
        classifier: DedupClassifier,
        source_id: str,
        existing_doc: dict[str, Any],
    ) -> None:
        result = classifier.classify(
            content_checksum="abc123def456",
            source_id=source_id,
            title="Some Title",
            checksum_match=existing_doc,
        )

        assert result.tier == DedupTier.EXACT_DUPLICATE
        assert result.confidence == 1.0
        assert result.matched_document_id == existing_doc["id"]
        assert result.should_skip_ingestion is True
        assert result.is_version_update is False
        assert result.needs_review is False
        assert result.evidence["method"] == "checksum"

    def test_checksum_match_takes_priority_over_everything(
        self,
        classifier: DedupClassifier,
        source_id: str,
        existing_doc: dict[str, Any],
    ) -> None:
        """Even if GR No. and title also match, checksum wins."""
        result = classifier.classify(
            content_checksum="abc123def456",
            source_id=source_id,
            title=existing_doc["title"],
            gr_no=existing_doc["gr_no"],
            checksum_match=existing_doc,
            gr_no_same_source_match=existing_doc,
            title_candidates=[existing_doc],
        )

        assert result.tier == DedupTier.EXACT_DUPLICATE


class TestCanonicalUrlMatch:
    """Tier 2: canonical_url_match — same canonical_url + different checksum.

    Must stay reviewer-gated (needs_review=True, should_skip_ingestion=False)
    because mirror sites (Lawphil ↔ SC E-Library) publish under the same URL
    but content can diverge.
    """

    def test_canonical_url_match_returns_pending_tier(
        self,
        classifier: DedupClassifier,
        source_id: str,
    ) -> None:
        existing = {
            "id": make_uuid(),
            "title": "Republic v. Sandiganbayan",
            "checksum": "old_checksum",
            "source_id": make_uuid(),
        }

        result = classifier.classify(
            content_checksum="new_different_checksum",
            source_id=source_id,
            title="Republic v. Sandiganbayan",
            canonical_url="https://lawphil.net/judjuris/juri2024/jan2024/gr_123456_2024.html",
            canonical_url_match=existing,
        )

        assert result.tier == DedupTier.CANONICAL_URL_MATCH
        assert result.confidence == 0.75
        assert result.matched_document_id == existing["id"]
        assert result.needs_review is True
        assert result.should_skip_ingestion is False
        assert result.is_version_update is False
        assert result.evidence["method"] == "canonical_url"
        assert result.evidence["matched_on"] == "canonical_url"
        assert (
            result.evidence["url"]
            == "https://lawphil.net/judjuris/juri2024/jan2024/gr_123456_2024.html"
        )

    def test_canonical_url_same_checksum_does_not_trigger(
        self,
        classifier: DedupClassifier,
        source_id: str,
    ) -> None:
        """If the candidate's checksum matches the existing doc at that URL,
        the canonical_url tier does NOT fire — that's a checksum match, which
        is handled upstream. The fallback assumes the candidate already
        survived the checksum tier."""
        existing = {
            "id": make_uuid(),
            "checksum": "same_checksum",
        }

        result = classifier.classify(
            content_checksum="same_checksum",
            source_id=source_id,
            title="Some Title",
            canonical_url="https://example.com/doc",
            canonical_url_match=existing,
        )

        assert result.tier != DedupTier.CANONICAL_URL_MATCH
        assert result.tier == DedupTier.NEW_DOCUMENT

    def test_checksum_match_wins_over_canonical_url(
        self,
        classifier: DedupClassifier,
        source_id: str,
    ) -> None:
        """Checksum match (exact_duplicate) MUST pre-empt canonical_url.
        The user explicitly required this: canonical_url is a FALLBACK, never
        a pre-empt."""
        checksum_doc = {
            "id": make_uuid(),
            "title": "Byte-identical content",
            "source_id": make_uuid(),
        }
        canonical_url_doc = {
            "id": make_uuid(),
            "title": "Different content at same URL",
            "checksum": "different_checksum",
        }

        result = classifier.classify(
            content_checksum="abc123",
            source_id=source_id,
            title="Some Title",
            canonical_url="https://example.com/doc",
            checksum_match=checksum_doc,
            canonical_url_match=canonical_url_doc,
        )

        assert result.tier == DedupTier.EXACT_DUPLICATE
        assert result.matched_document_id == checksum_doc["id"]

    def test_canonical_url_match_without_url_does_not_fire(
        self,
        classifier: DedupClassifier,
        source_id: str,
    ) -> None:
        """Defensive guard: if canonical_url is None we never fire the tier,
        even if the caller mistakenly populated canonical_url_match."""
        existing = {
            "id": make_uuid(),
            "checksum": "old_checksum",
        }

        result = classifier.classify(
            content_checksum="new_checksum",
            source_id=source_id,
            title="No URL Provided",
            canonical_url=None,
            canonical_url_match=existing,
        )

        assert result.tier != DedupTier.CANONICAL_URL_MATCH

    def test_canonical_url_match_evidence_includes_checksums(
        self,
        classifier: DedupClassifier,
        source_id: str,
    ) -> None:
        existing = {
            "id": make_uuid(),
            "checksum": "old_abc",
            "source_id": "source-xyz",
        }

        result = classifier.classify(
            content_checksum="new_def",
            source_id=source_id,
            title="Test",
            canonical_url="https://example.com/x",
            canonical_url_match=existing,
        )

        assert result.tier == DedupTier.CANONICAL_URL_MATCH
        assert result.evidence["existing_checksum"] == "old_abc"
        assert result.evidence["new_checksum"] == "new_def"
        assert result.evidence["matched_source_id"] == "source-xyz"


class TestMirrorDuplicate:
    """Tier 2: mirror_duplicate — same GR No. from different source."""

    def test_gr_no_cross_source_with_same_citation(
        self,
        classifier: DedupClassifier,
        source_id: str,
        other_source_id: str,
    ) -> None:
        cross_source_doc = {
            "id": make_uuid(),
            "title": "Republic v. Sandiganbayan",
            "gr_no": "G.R. No. 123456",
            "citation_text": "G.R. No. 123456, January 15, 2024",
            "source_id": other_source_id,
            "court": "Supreme Court",
        }

        result = classifier.classify(
            content_checksum="new_checksum",
            source_id=source_id,
            title="Republic v. Sandiganbayan",
            gr_no="G.R. No. 123456",
            citation_text="G.R. No. 123456, January 15, 2024",
            gr_no_cross_source_matches=[cross_source_doc],
        )

        assert result.tier == DedupTier.MIRROR_DUPLICATE
        assert result.confidence == 0.95  # Citation match → higher confidence
        assert result.matched_document_id == cross_source_doc["id"]
        assert result.should_skip_ingestion is True
        assert result.evidence["citation_match"] is True

    def test_gr_no_cross_source_without_citation(
        self,
        classifier: DedupClassifier,
        source_id: str,
        other_source_id: str,
    ) -> None:
        cross_source_doc = {
            "id": make_uuid(),
            "title": "Republic v. Sandiganbayan",
            "gr_no": "G.R. No. 123456",
            "citation_text": "",
            "source_id": other_source_id,
        }

        result = classifier.classify(
            content_checksum="new_checksum",
            source_id=source_id,
            title="Republic v. Sandiganbayan",
            gr_no="G.R. No. 123456",
            gr_no_cross_source_matches=[cross_source_doc],
        )

        assert result.tier == DedupTier.MIRROR_DUPLICATE
        assert result.confidence == 0.90  # No citation match → base confidence

    def test_mirror_requires_gr_no(
        self,
        classifier: DedupClassifier,
        source_id: str,
    ) -> None:
        """Without a GR No., mirror detection is skipped."""
        cross_source_doc = {
            "id": make_uuid(),
            "title": "Some Law",
            "source_id": make_uuid(),
        }

        result = classifier.classify(
            content_checksum="new_checksum",
            source_id=source_id,
            title="Some Law",
            gr_no=None,
            gr_no_cross_source_matches=[cross_source_doc],
        )

        assert result.tier != DedupTier.MIRROR_DUPLICATE


class TestVersionUpdate:
    """Tier 3: version_update — same GR No. + same source + different checksum."""

    def test_same_source_different_checksum(
        self,
        classifier: DedupClassifier,
        source_id: str,
        existing_doc: dict[str, Any],
    ) -> None:
        result = classifier.classify(
            content_checksum="new_different_checksum",
            source_id=source_id,
            title="Republic v. Sandiganbayan",
            gr_no="G.R. No. 123456",
            gr_no_same_source_match=existing_doc,
        )

        assert result.tier == DedupTier.VERSION_UPDATE
        assert result.confidence >= 0.80
        assert result.matched_document_id == existing_doc["id"]
        assert result.is_version_update is True
        assert result.should_skip_ingestion is False
        assert result.evidence["method"] == "gr_no_same_source_version"

    def test_version_update_higher_confidence_with_date(
        self,
        classifier: DedupClassifier,
        source_id: str,
    ) -> None:
        existing = {
            "id": make_uuid(),
            "checksum": "old_checksum",
            "decision_date": "2024-01-15",
            "version_no": 1,
        }

        result = classifier.classify(
            content_checksum="new_checksum",
            source_id=source_id,
            title="Test Case",
            gr_no="G.R. No. 999999",
            gr_no_same_source_match=existing,
        )

        assert result.tier == DedupTier.VERSION_UPDATE
        assert result.confidence == 0.85

    def test_version_update_lower_confidence_without_date(
        self,
        classifier: DedupClassifier,
        source_id: str,
    ) -> None:
        existing = {
            "id": make_uuid(),
            "checksum": "old_checksum",
            "decision_date": None,
            "version_no": 1,
        }

        result = classifier.classify(
            content_checksum="new_checksum",
            source_id=source_id,
            title="Test Case",
            gr_no="G.R. No. 999999",
            gr_no_same_source_match=existing,
        )

        assert result.tier == DedupTier.VERSION_UPDATE
        assert result.confidence == 0.80

    def test_same_checksum_is_not_version_update(
        self,
        classifier: DedupClassifier,
        source_id: str,
    ) -> None:
        """If checksums match but through GR No., it's not a version update."""
        existing = {
            "id": make_uuid(),
            "checksum": "same_checksum",
            "decision_date": "2024-01-15",
            "version_no": 1,
        }

        result = classifier.classify(
            content_checksum="same_checksum",
            source_id=source_id,
            title="Test Case",
            gr_no="G.R. No. 999999",
            gr_no_same_source_match=existing,
        )

        # Same checksum → should not trigger version_update
        assert result.tier != DedupTier.VERSION_UPDATE


class TestPossibleDuplicate:
    """Tier 4: possible_duplicate — title Levenshtein similarity >= threshold."""

    def test_title_above_threshold(
        self,
        classifier: DedupClassifier,
        source_id: str,
    ) -> None:
        similar_doc = {
            "id": make_uuid(),
            "title": "Republic of the Philippines v. Sandiganbayan",
            "court": "Supreme Court",
            "citation_text": "G.R. No. 111111",
            "checksum": "other_checksum",
        }

        result = classifier.classify(
            content_checksum="new_checksum",
            source_id=source_id,
            title="Republic of the Philippines vs. Sandiganbayan",
            court="Supreme Court",
            title_candidates=[similar_doc],
        )

        assert result.tier == DedupTier.POSSIBLE_DUPLICATE
        assert result.confidence >= 0.65
        assert result.matched_document_id == similar_doc["id"]
        assert result.needs_review is True
        assert result.should_skip_ingestion is False

    def test_title_below_threshold_is_new(
        self,
        classifier: DedupClassifier,
        source_id: str,
    ) -> None:
        different_doc = {
            "id": make_uuid(),
            "title": "People of the Philippines v. John Doe, Criminal Case 2024",
            "court": "RTC",
        }

        result = classifier.classify(
            content_checksum="new_checksum",
            source_id=source_id,
            title="Republic Act No. 12345 - Environmental Protection Law",
            title_candidates=[different_doc],
        )

        assert result.tier == DedupTier.NEW_DOCUMENT

    def test_very_high_title_similarity_higher_confidence(
        self,
        classifier: DedupClassifier,
        source_id: str,
    ) -> None:
        """Title similarity >= 0.90 should give confidence 0.70."""
        almost_same_doc = {
            "id": make_uuid(),
            "title": "People v. Juan Dela Cruz",
            "court": "Supreme Court",
        }

        result = classifier.classify(
            content_checksum="new_checksum",
            source_id=source_id,
            title="People v. Juan dela Cruz",  # Same except case
            court="Supreme Court",
            title_candidates=[almost_same_doc],
        )

        assert result.tier == DedupTier.POSSIBLE_DUPLICATE
        assert result.confidence == 0.70

    def test_same_court_boosts_confidence(
        self,
        classifier: DedupClassifier,
        source_id: str,
    ) -> None:
        similar_doc = {
            "id": make_uuid(),
            "title": "Manila Electric Company v. Public Utilities Commission",
            "court": "Supreme Court",
        }

        result = classifier.classify(
            content_checksum="new_checksum",
            source_id=source_id,
            title="Manila Electric Co. v. Public Utilities Commission",
            court="Supreme Court",
            title_candidates=[similar_doc],
        )

        if result.tier == DedupTier.POSSIBLE_DUPLICATE:
            assert result.evidence.get("same_court") is True


class TestNewDocument:
    """Tier 5: new_document — no match above threshold."""

    def test_no_matches_at_all(
        self,
        classifier: DedupClassifier,
        source_id: str,
    ) -> None:
        result = classifier.classify(
            content_checksum="brand_new_checksum",
            source_id=source_id,
            title="Completely New Legal Document 2024",
        )

        assert result.tier == DedupTier.NEW_DOCUMENT
        assert result.confidence == 0.0
        assert result.matched_document_id is None
        assert result.should_skip_ingestion is False
        assert result.is_version_update is False
        assert result.needs_review is False

    def test_empty_candidates_lists(
        self,
        classifier: DedupClassifier,
        source_id: str,
    ) -> None:
        result = classifier.classify(
            content_checksum="new_checksum",
            source_id=source_id,
            title="New Document",
            checksum_match=None,
            gr_no_same_source_match=None,
            gr_no_cross_source_matches=[],
            title_candidates=[],
        )

        assert result.tier == DedupTier.NEW_DOCUMENT


class TestTierPriority:
    """Verify cascade ordering: checksum → GR cross → GR same → title → new."""

    def test_checksum_beats_gr_no(
        self,
        classifier: DedupClassifier,
        source_id: str,
    ) -> None:
        doc = {
            "id": make_uuid(),
            "title": "Test",
            "gr_no": "G.R. No. 123",
            "citation_text": "cite",
            "source_id": make_uuid(),
            "checksum": "abc",
            "court": "SC",
            "version_no": 1,
            "decision_date": "2024-01-01",
        }

        result = classifier.classify(
            content_checksum="abc",
            source_id=source_id,
            title="Test",
            gr_no="G.R. No. 123",
            checksum_match=doc,
            gr_no_cross_source_matches=[doc],
            gr_no_same_source_match=doc,
            title_candidates=[doc],
        )

        assert result.tier == DedupTier.EXACT_DUPLICATE

    def test_mirror_beats_version_update(
        self,
        classifier: DedupClassifier,
        source_id: str,
    ) -> None:
        other_source = make_uuid()
        cross_doc = {
            "id": make_uuid(),
            "title": "Test",
            "gr_no": "G.R. No. 123",
            "citation_text": "G.R. No. 123",
            "source_id": other_source,
        }
        same_doc = {
            "id": make_uuid(),
            "checksum": "old",
            "decision_date": "2024-01-01",
            "version_no": 1,
        }

        result = classifier.classify(
            content_checksum="new_checksum",
            source_id=source_id,
            title="Test",
            gr_no="G.R. No. 123",
            citation_text="G.R. No. 123",
            gr_no_cross_source_matches=[cross_doc],
            gr_no_same_source_match=same_doc,
        )

        assert result.tier == DedupTier.MIRROR_DUPLICATE


class TestDedupResult:
    """Test DedupResult properties."""

    def test_should_skip_exact(self) -> None:
        result = DedupResult(tier=DedupTier.EXACT_DUPLICATE, confidence=1.0)
        assert result.should_skip_ingestion is True

    def test_should_skip_mirror(self) -> None:
        result = DedupResult(tier=DedupTier.MIRROR_DUPLICATE, confidence=0.95)
        assert result.should_skip_ingestion is True

    def test_should_not_skip_version(self) -> None:
        result = DedupResult(tier=DedupTier.VERSION_UPDATE, confidence=0.85)
        assert result.should_skip_ingestion is False

    def test_should_not_skip_possible(self) -> None:
        result = DedupResult(tier=DedupTier.POSSIBLE_DUPLICATE, confidence=0.70)
        assert result.should_skip_ingestion is False

    def test_should_not_skip_canonical_url_match(self) -> None:
        """canonical_url_match MUST ingest + write a pending review row.
        Reviewer-gated by design — never auto-dismissed.
        """
        result = DedupResult(tier=DedupTier.CANONICAL_URL_MATCH, confidence=0.75)
        assert result.should_skip_ingestion is False

    def test_should_not_skip_new(self) -> None:
        result = DedupResult(tier=DedupTier.NEW_DOCUMENT, confidence=0.0)
        assert result.should_skip_ingestion is False

    def test_needs_review_possible_and_canonical_url(self) -> None:
        """needs_review is True for both POSSIBLE_DUPLICATE and
        CANONICAL_URL_MATCH — both require human classification."""
        review_tiers = {
            DedupTier.POSSIBLE_DUPLICATE,
            DedupTier.CANONICAL_URL_MATCH,
        }
        for tier in DedupTier:
            result = DedupResult(tier=tier, confidence=0.5)
            if tier in review_tiers:
                assert result.needs_review is True
            else:
                assert result.needs_review is False

    def test_is_version_update_only_version(self) -> None:
        for tier in DedupTier:
            result = DedupResult(tier=tier, confidence=0.5)
            if tier == DedupTier.VERSION_UPDATE:
                assert result.is_version_update is True
            else:
                assert result.is_version_update is False
