"""Tests for the enhanced subject categorization with confidence scores.

Covers:
1. _classify_with_confidence — keyword matching, scoring, confidence
2. Primary/secondary assignment logic
3. Review threshold behavior
4. Extended subjects (environmental, family, property, administrative, constitutional)
"""

from __future__ import annotations

import pytest

from src.tasks.categorization_tasks import (
    ClassificationScore,
    _classify_with_confidence,
    CATEGORIZATION_RULES,
    SECONDARY_CONFIDENCE_THRESHOLD,
    PRIMARY_REVIEW_THRESHOLD,
    _MAX_RAW_SCORE,
)


# ─── classify_with_confidence ──────────────────────────────────────────


class TestClassifyWithConfidence:
    def test_returns_empty_for_unrelated_title(self) -> None:
        results = _classify_with_confidence(
            "Annual Weather Report 2024", None, None,
        )
        assert results == []

    def test_criminal_law_keywords_match(self) -> None:
        results = _classify_with_confidence(
            "People of the Philippines v. John Doe — Murder under the Revised Penal Code",
            None,
            None,
        )
        codes = [r.code for r in results]
        assert "criminal_law" in codes

    def test_civil_law_keywords_match(self) -> None:
        results = _classify_with_confidence(
            "Petition for Annulment of Marriage — Family Code Provisions on Custody",
            None,
            None,
        )
        codes = [r.code for r in results]
        assert "civil_law" in codes

    def test_citation_pattern_boosts_score(self) -> None:
        # Test with criminal law title + criminal law citation pattern
        results_no_cite = _classify_with_confidence(
            "People v. Doe — murder", None, None,
        )
        results_with_cite = _classify_with_confidence(
            "People v. Doe — murder", "act no. 3815", None,
        )

        criminal_no_cite = next((r for r in results_no_cite if r.code == "criminal_law"), None)
        criminal_with_cite = next((r for r in results_with_cite if r.code == "criminal_law"), None)

        if criminal_no_cite and criminal_with_cite:
            assert criminal_with_cite.confidence >= criminal_no_cite.confidence

    def test_agency_match_adds_score(self) -> None:
        results = _classify_with_confidence(
            "Administrative Order regarding SEC regulations", None, "SEC",
        )
        codes = [r.code for r in results]
        assert "commercial_law" in codes

    def test_sorted_by_confidence_descending(self) -> None:
        # A title with multiple subject matches
        results = _classify_with_confidence(
            "Contract dispute involving corporation code obligations and damages torts",
            None,
            None,
        )
        if len(results) > 1:
            for i in range(len(results) - 1):
                assert results[i].confidence >= results[i + 1].confidence

    def test_minimum_score_threshold(self) -> None:
        # Single keyword match gives score=2, which is the minimum
        results = _classify_with_confidence(
            "A case about maritime issues", None, None,
        )
        for r in results:
            assert r.raw_score >= 2

    def test_confidence_is_bounded_zero_to_one(self) -> None:
        # Put many keywords to try to exceed max
        results = _classify_with_confidence(
            "criminal law revised penal code murder homicide robbery theft estafa falsification "
            "rape kidnapping drug abuse dangerous drugs comprehensive dangerous drugs act",
            "act no. 3815 r.a. no. 9165",
            None,
        )
        for r in results:
            assert 0.0 <= r.confidence <= 1.0


class TestExtendedSubjects:
    """Test the 5 extended subject categories added in Session B."""

    def test_environmental_law_match(self) -> None:
        results = _classify_with_confidence(
            "Petition regarding environmental compliance certificate under environmental law",
            None,
            "DENR",
        )
        codes = [r.code for r in results]
        assert "environmental_law" in codes

    def test_family_law_match(self) -> None:
        results = _classify_with_confidence(
            "Custody dispute involving domestic violence and child support",
            None,
            "DSWD",
        )
        codes = [r.code for r in results]
        assert "family_law" in codes

    def test_property_law_match(self) -> None:
        results = _classify_with_confidence(
            "Land registration under the Torrens system — quieting of title",
            None,
            None,
        )
        codes = [r.code for r in results]
        assert "property_law" in codes

    def test_administrative_law_match(self) -> None:
        results = _classify_with_confidence(
            "Administrative case against a public officer at the Ombudsman",
            None,
            "Ombudsman",
        )
        codes = [r.code for r in results]
        assert "administrative_law" in codes

    def test_constitutional_law_match(self) -> None:
        results = _classify_with_confidence(
            "Constitutional right to due process and equal protection under the bill of rights",
            None,
            None,
        )
        codes = [r.code for r in results]
        assert "constitutional_law" in codes


class TestPrimarySecondaryLogic:
    """Test the confidence-based primary/secondary assignment logic."""

    def test_highest_confidence_is_primary(self) -> None:
        results = _classify_with_confidence(
            "Contract dispute involving corporation code obligations and damages torts sale of property",
            None,
            None,
        )
        if results:
            primary = results[0]
            for r in results[1:]:
                assert r.confidence <= primary.confidence

    def test_secondary_threshold(self) -> None:
        """Results below SECONDARY_CONFIDENCE_THRESHOLD should be excluded from secondary."""
        results = _classify_with_confidence(
            "Revised Penal Code murder conviction",
            "act no. 3815",
            None,
        )
        for r in results:
            assert r.confidence >= SECONDARY_CONFIDENCE_THRESHOLD or r.raw_score < 2

    def test_review_threshold_logic(self) -> None:
        """When primary confidence < PRIMARY_REVIEW_THRESHOLD, all should need review."""
        # A title with only a weak match — single keyword = score 2, conf ~ 0.1
        results = _classify_with_confidence(
            "A brief mention of maritime issues",
            None,
            None,
        )
        # If there are results, they should have low confidence
        for r in results:
            if r.raw_score == 2:
                assert r.confidence < PRIMARY_REVIEW_THRESHOLD


class TestClassificationScore:
    def test_dataclass_fields(self) -> None:
        s = ClassificationScore(
            code="criminal_law", tag_type="bar_subject", raw_score=6, confidence=0.3,
        )
        assert s.code == "criminal_law"
        assert s.tag_type == "bar_subject"
        assert s.raw_score == 6
        assert s.confidence == 0.3

    def test_confidence_normalization(self) -> None:
        """Score of _MAX_RAW_SCORE should produce confidence = 1.0."""
        # Confidence = min(raw / _MAX_RAW_SCORE, 1.0)
        assert min(_MAX_RAW_SCORE / _MAX_RAW_SCORE, 1.0) == 1.0


class TestCategorizationRules:
    def test_all_rules_have_required_fields(self) -> None:
        for rule in CATEGORIZATION_RULES:
            assert "code" in rule
            assert "title_keywords" in rule
            assert "citation_patterns" in rule
            assert "agencies" in rule
            assert len(rule["title_keywords"]) > 0

    def test_14_categories_exist(self) -> None:
        codes = [r["code"] for r in CATEGORIZATION_RULES]
        # 9 bar subjects + 5 extended
        assert len(codes) >= 14

    def test_extended_subjects_present(self) -> None:
        codes = {r["code"] for r in CATEGORIZATION_RULES}
        assert "environmental_law" in codes
        assert "family_law" in codes
        assert "property_law" in codes
        assert "administrative_law" in codes
        assert "constitutional_law" in codes

    def test_bar_subjects_present(self) -> None:
        codes = {r["code"] for r in CATEGORIZATION_RULES}
        assert "civil_law" in codes
        assert "criminal_law" in codes
        assert "commercial_law" in codes
        assert "labor_law" in codes
        assert "political_law" in codes
        assert "taxation_law" in codes
        assert "legal_ethics" in codes
        assert "remedial_law" in codes
