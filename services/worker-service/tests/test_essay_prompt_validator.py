"""Tests for EssayPromptValidator (PR 5.2).

14 tests covering:
1. Happy path — valid prompt + ALAC model answer + rubric -> PUBLISH
2. Abstain -> QUARANTINE
3. Empty prompt text -> QUARANTINE
4. Prompt too short (< 50 words) -> HUMAN_REVIEW
5. Prompt too long (> 600 words) -> HUMAN_REVIEW
6. Suggested time below 15 -> HUMAN_REVIEW
7. Suggested time above 90 -> HUMAN_REVIEW
8. Model answer missing ALAC headings -> HUMAN_REVIEW
9. Model answer paragraph without citation -> HUMAN_REVIEW
10. Model answer cites non-existent section -> HUMAN_REVIEW
11. Rubric criteria < 3 -> HUMAN_REVIEW
12. Rubric maxPoints don't sum to totalPoints -> HUMAN_REVIEW
13. Rubric criterion with empty description -> HUMAN_REVIEW
14. No model answer, no rubric (prompt only) -> PUBLISH
"""

from __future__ import annotations

import pytest

from src.validators.derivative_validators import (
    DerivativeVerdict,
    LegalDocumentSectionSnapshot,
    LegalDocumentSnapshot,
)
from src.validators.derivative_validators.essay_prompt_validator import (
    EssayPromptValidator,
)

# ---------------------------------------------------------------------------
# Fixtures & Helpers
# ---------------------------------------------------------------------------

FAKE_SOURCE_DOC = LegalDocumentSnapshot(
    id="doc-001",
    title="Republic v. Sandiganbayan",
    document_type="case",
    citation_text="G.R. No. 123456, January 1, 2025",
    court="Supreme Court",
    decision_date="2025-01-01",
    confidence_score=0.9,
)

FAKE_SECTIONS = [
    LegalDocumentSectionSnapshot(
        id="sec-001",
        section_type="body",
        plain_text=(
            "The doctrine of command responsibility applies to civilian officials "
            "who hold positions of authority in the government. This principle requires "
            "that officials exercising effective control over subordinates may be held "
            "liable for the acts of those subordinates."
        ),
        page_start=1,
        page_end=5,
    ),
    LegalDocumentSectionSnapshot(
        id="sec-002",
        section_type="body",
        plain_text="WHEREFORE, the petition is GRANTED. The decision is affirmed in toto.",
        page_start=5,
        page_end=6,
    ),
]

# 60 words — valid length
VALID_PROMPT_TEXT = (
    "Atty. Santos is a government official who oversees a department of twenty employees. "
    "One of his subordinates, Mr. Cruz, committed an act of corruption by accepting a bribe "
    "from a contractor. Atty. Santos was aware of the corrupt activities but failed to take "
    "any action to prevent or punish the subordinate. Discuss the legal liability of Atty. Santos "
    "under the doctrine of command responsibility."
)

VALID_MODEL_ANSWER = {
    "outlineSections": [
        {
            "heading": "Answer",
            "paragraphs": ["Atty. Santos may be held liable under the doctrine of command responsibility."],
            "citedSectionIds": ["sec-001"],
        },
        {
            "heading": "Law",
            "paragraphs": [
                "The doctrine of command responsibility applies to civilian officials.",
                "Officials with effective control may be held liable for subordinates' acts.",
            ],
            "citedSectionIds": ["sec-001", "sec-002"],
        },
        {
            "heading": "Application",
            "paragraphs": ["Applying the doctrine to Atty. Santos, he had effective control and failed to act."],
            "citedSectionIds": ["sec-001"],
        },
        {
            "heading": "Conclusion",
            "paragraphs": ["Therefore, Atty. Santos is liable under command responsibility."],
            "citedSectionIds": ["sec-001"],
        },
    ],
}

VALID_RUBRIC = {
    "totalPoints": 100,
    "criteria": [
        {"name": "Issue Identification", "maxPoints": 20, "description": "Identifies the relevant legal issue"},
        {"name": "Legal Knowledge", "maxPoints": 30, "description": "Demonstrates knowledge of the doctrine"},
        {"name": "Application and Analysis", "maxPoints": 35, "description": "Applies law to facts correctly"},
        {"name": "Conclusion and Writing", "maxPoints": 15, "description": "Clear conclusion and writing style"},
    ],
}


def _make_content(overrides: dict | None = None) -> dict:
    base = {
        "promptText": VALID_PROMPT_TEXT,
        "suggestedTimeMinutes": 30,
        "modelAnswer": VALID_MODEL_ANSWER,
        "rubric": VALID_RUBRIC,
        "abstain": False,
        "abstainReason": None,
    }
    if overrides:
        base.update(overrides)
    return base


def _validate(content: dict) -> object:
    validator = EssayPromptValidator()
    return validator.validate(
        derivative_type="essay_prompt",
        content=content,
        source_document=FAKE_SOURCE_DOC,
        source_sections=FAKE_SECTIONS,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestEssayPromptValidator:
    """Tests for the EssayPromptValidator."""

    def test_1_happy_path_publish(self) -> None:
        """Valid prompt + ALAC model answer + rubric -> PUBLISH."""
        content = _make_content()
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.PUBLISH
        assert len(result.reasons) == 0

    def test_2_abstain_quarantine(self) -> None:
        """Abstain -> QUARANTINE."""
        content = _make_content({
            "abstain": True,
            "abstainReason": "Insufficient source material",
        })
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.QUARANTINE
        assert any("abstained" in r.lower() for r in result.reasons)

    def test_3_empty_prompt_quarantine(self) -> None:
        """Empty prompt text -> QUARANTINE (error severity for 0 words)."""
        content = _make_content({"promptText": ""})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.QUARANTINE
        assert any("0 words" in r for r in result.reasons)

    def test_4_prompt_too_short_human_review(self) -> None:
        """Prompt < 50 words -> HUMAN_REVIEW."""
        short_prompt = "Discuss the liability of the accused under the law."
        content = _make_content({"promptText": short_prompt})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("words" in r for r in result.reasons)

    def test_5_prompt_too_long_human_review(self) -> None:
        """Prompt > 600 words -> HUMAN_REVIEW."""
        long_prompt = "word " * 601
        content = _make_content({"promptText": long_prompt})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("601 words" in r for r in result.reasons)

    def test_6_suggested_time_below_15_human_review(self) -> None:
        """Suggested time < 15 -> HUMAN_REVIEW."""
        content = _make_content({"suggestedTimeMinutes": 10})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("10m" in r for r in result.reasons)

    def test_7_suggested_time_above_90_human_review(self) -> None:
        """Suggested time > 90 -> HUMAN_REVIEW."""
        content = _make_content({"suggestedTimeMinutes": 120})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("120m" in r for r in result.reasons)

    def test_8_missing_alac_headings_human_review(self) -> None:
        """Model answer missing ALAC headings -> HUMAN_REVIEW."""
        bad_answer = {
            "outlineSections": [
                {
                    "heading": "Issue",  # Wrong! Should be "Answer"
                    "paragraphs": ["Some text"],
                    "citedSectionIds": ["sec-001"],
                },
                {
                    "heading": "Rule",  # Wrong! Should be "Law"
                    "paragraphs": ["Some text"],
                    "citedSectionIds": ["sec-001"],
                },
            ],
        }
        content = _make_content({"modelAnswer": bad_answer})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("Missing ALAC headings" in r for r in result.reasons)

    def test_9_paragraph_without_citation_human_review(self) -> None:
        """Model answer paragraph without citation -> HUMAN_REVIEW."""
        bad_answer = {
            "outlineSections": [
                {
                    "heading": "Answer",
                    "paragraphs": ["Uncited paragraph here"],
                    "citedSectionIds": [],  # No citations!
                },
                {
                    "heading": "Law",
                    "paragraphs": ["Some law text"],
                    "citedSectionIds": ["sec-001"],
                },
                {
                    "heading": "Application",
                    "paragraphs": ["Application text"],
                    "citedSectionIds": ["sec-001"],
                },
                {
                    "heading": "Conclusion",
                    "paragraphs": ["Conclusion text"],
                    "citedSectionIds": ["sec-001"],
                },
            ],
        }
        content = _make_content({"modelAnswer": bad_answer})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("no citedSectionIds" in r for r in result.reasons)

    def test_10_nonexistent_section_human_review(self) -> None:
        """Model answer cites non-existent section -> HUMAN_REVIEW."""
        bad_answer = {
            "outlineSections": [
                {
                    "heading": "Answer",
                    "paragraphs": ["Some text"],
                    "citedSectionIds": ["nonexistent-section-id"],
                },
                {
                    "heading": "Law",
                    "paragraphs": ["Some law text"],
                    "citedSectionIds": ["sec-001"],
                },
                {
                    "heading": "Application",
                    "paragraphs": ["Application text"],
                    "citedSectionIds": ["sec-001"],
                },
                {
                    "heading": "Conclusion",
                    "paragraphs": ["Conclusion text"],
                    "citedSectionIds": ["sec-001"],
                },
            ],
        }
        content = _make_content({"modelAnswer": bad_answer})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("not in source" in r for r in result.reasons)

    def test_11_rubric_criteria_too_few_human_review(self) -> None:
        """Rubric criteria < 3 -> HUMAN_REVIEW."""
        bad_rubric = {
            "totalPoints": 100,
            "criteria": [
                {"name": "Knowledge", "maxPoints": 50, "description": "Legal knowledge"},
                {"name": "Analysis", "maxPoints": 50, "description": "Application"},
            ],
        }
        content = _make_content({"rubric": bad_rubric})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("2" in r and "min 3" in r for r in result.reasons)

    def test_12_rubric_points_mismatch_human_review(self) -> None:
        """Rubric maxPoints don't sum to totalPoints -> HUMAN_REVIEW."""
        bad_rubric = {
            "totalPoints": 100,
            "criteria": [
                {"name": "Issue ID", "maxPoints": 20, "description": "Identifies issues"},
                {"name": "Knowledge", "maxPoints": 30, "description": "Legal knowledge"},
                {"name": "Analysis", "maxPoints": 40, "description": "Application"},
                # Sum = 90, not 100
            ],
        }
        content = _make_content({"rubric": bad_rubric})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("sum 90 vs totalPoints 100" in r for r in result.reasons)

    def test_13_rubric_empty_description_human_review(self) -> None:
        """Rubric criterion with empty description -> HUMAN_REVIEW."""
        bad_rubric = {
            "totalPoints": 100,
            "criteria": [
                {"name": "Issue ID", "maxPoints": 20, "description": "Identifies issues"},
                {"name": "Knowledge", "maxPoints": 30, "description": ""},  # Empty!
                {"name": "Analysis", "maxPoints": 35, "description": "Application"},
                {"name": "Conclusion", "maxPoints": 15, "description": "Wrapping up"},
            ],
        }
        content = _make_content({"rubric": bad_rubric})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("empty" in r for r in result.reasons)

    def test_14_prompt_only_no_answer_no_rubric_publish(self) -> None:
        """No model answer, no rubric (prompt only) -> PUBLISH."""
        content = _make_content({
            "modelAnswer": None,
            "rubric": None,
        })
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.PUBLISH
        assert len(result.reasons) == 0
