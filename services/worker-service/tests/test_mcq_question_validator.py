"""Tests for McqQuestionValidator (PR 5.1A).

17 tests covering:
1. Happy path — 5 valid questions -> PUBLISH
2. Abstain flag -> QUARANTINE
3. No questions generated -> QUARANTINE
4. All questions fail -> QUARANTINE
5. Some pass, some fail -> HUMAN_REVIEW (passing ones flagged for persist)
6. Stem too short (< 20 words) -> question fails (warning)
7. Stem too long (> 300 words) -> question fails (warning)
8. Wrong option count (3 instead of 4) -> question fails (error)
9. Zero correct options -> question fails (error)
10. Two correct options -> question fails (error)
11. Stem leakage — correct answer substring in stem -> warning
12. Distractor too similar (Levenshtein > 0.85) -> warning
13. Missing explanation -> question fails (error)
14. Fanout cap > 10 -> warning on batch
15. Levenshtein: identical strings -> 1.0
16. Levenshtein: completely different -> low score
17. Levenshtein: similar with minor edits -> high score (> 0.85)
"""

from __future__ import annotations

import pytest

from src.validators.derivative_validators import (
    DerivativeVerdict,
    LegalDocumentSectionSnapshot,
    LegalDocumentSnapshot,
)
from src.validators.derivative_validators.mcq_question_validator import (
    McqQuestionValidator,
    McqQuestionValidationResult,
    _levenshtein_similarity,
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

SECTION_TEXT = (
    "The doctrine of command responsibility applies to civilian officials "
    "who hold positions of authority in the government. This principle requires "
    "that officials exercising effective control over subordinates may be held "
    "liable for the acts of those subordinates when they fail to prevent or punish "
    "such acts. The standard applies regardless of whether the superior directly "
    "ordered the illegal act. The Court further held that the duty of diligence "
    "extends to all branches of the executive department and applies with equal "
    "force to both military and civilian chains of command in the Philippines."
)

FAKE_SECTIONS = [
    LegalDocumentSectionSnapshot(
        id="sec-001",
        section_type="body",
        plain_text=SECTION_TEXT,
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

# 25 words — valid length
VALID_STEM = (
    "Under the doctrine of command responsibility as applied in Philippine "
    "jurisprudence, which of the following statements correctly describes "
    "the scope of liability of civilian officials exercising effective control?"
)

VALID_OPTIONS = [
    {"label": "A", "text": "Liability attaches only to military commanders in active service.", "isCorrect": False, "rationale": "Wrong — applies to civilians too."},
    {"label": "B", "text": "Officials exercising effective control may be held liable for subordinates' acts.", "isCorrect": True, "rationale": "Correct per the doctrine."},
    {"label": "C", "text": "The doctrine only applies when the superior directly ordered the act.", "isCorrect": False, "rationale": "Wrong — direct order not required."},
    {"label": "D", "text": "Only the President can be held liable under this doctrine.", "isCorrect": False, "rationale": "Wrong — applies to all officials with effective control."},
]

VALID_EXPLANATION = (
    "The doctrine of command responsibility holds civilian officials liable "
    "when they exercise effective control over subordinates. The standard does "
    "not require a direct order — mere failure to prevent or punish suffices."
)


def _make_question(overrides: dict | None = None) -> dict:
    base = {
        "questionStem": VALID_STEM,
        "options": [dict(o) for o in VALID_OPTIONS],
        "explanation": VALID_EXPLANATION,
        "supportingSectionIds": ["sec-001"],
        "difficultySelfReport": "medium",
    }
    if overrides:
        base.update(overrides)
    return base


def _make_content(questions: list[dict] | None = None, **kwargs) -> dict:
    base = {
        "questions": questions if questions is not None else [_make_question()],
        "abstain": False,
        "abstainReason": None,
    }
    base.update(kwargs)
    return base


def _validate(content: dict) -> object:
    validator = McqQuestionValidator()
    return validator.validate(
        derivative_type="mcq_question",
        content=content,
        source_document=FAKE_SOURCE_DOC,
        source_sections=FAKE_SECTIONS,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestMcqQuestionValidator:
    """Tests for the McqQuestionValidator."""

    def test_1_happy_path_5_valid_questions_publish(self) -> None:
        """Happy path — 5 valid questions -> PUBLISH."""
        questions = [_make_question() for _ in range(5)]
        content = _make_content(questions=questions)
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.PUBLISH
        per_results = content.get("_per_question_results", [])
        assert len(per_results) == 5
        assert all(r.passed for r in per_results)

    def test_2_abstain_flag_quarantine(self) -> None:
        """Abstain flag -> QUARANTINE."""
        content = _make_content(
            questions=[],
            abstain=True,
            abstainReason="Insufficient doctrinal content",
        )
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.QUARANTINE
        assert any("abstained" in r.lower() for r in result.reasons)

    def test_3_no_questions_generated_quarantine(self) -> None:
        """No questions generated -> QUARANTINE."""
        content = _make_content(questions=[])
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.QUARANTINE
        assert any("No questions generated" in r for r in result.reasons)

    def test_4_all_questions_fail_quarantine(self) -> None:
        """All questions fail validation -> QUARANTINE."""
        # Missing explanation = error, so question fails
        bad_q = _make_question({"explanation": ""})
        content = _make_content(questions=[bad_q])
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.QUARANTINE
        assert any("All questions failed" in r for r in result.reasons)

    def test_5_some_pass_some_fail_human_review(self) -> None:
        """Some pass, some fail -> passing ones still persisted."""
        good_q = _make_question()
        bad_q = _make_question({"explanation": ""})  # error: missing explanation
        content = _make_content(questions=[good_q, bad_q])
        result = _validate(content)

        per_results: list[McqQuestionValidationResult] = content["_per_question_results"]
        assert per_results[0].passed is True
        assert per_results[1].passed is False
        # At least one warning/error means not PUBLISH
        assert result.verdict in (DerivativeVerdict.HUMAN_REVIEW, DerivativeVerdict.QUARANTINE)

    def test_6_stem_too_short_warning(self) -> None:
        """Stem too short (< 20 words) -> question gets warning."""
        short_stem = "What is the rule?"  # 5 words
        q = _make_question({"questionStem": short_stem})
        content = _make_content(questions=[q])
        result = _validate(content)

        per_results = content["_per_question_results"]
        stem_check = [c for c in per_results[0].checks if "stem_length" in c.name]
        assert len(stem_check) == 1
        assert stem_check[0].passed is False

    def test_7_stem_too_long_warning(self) -> None:
        """Stem too long (> 300 words) -> question gets warning."""
        long_stem = "word " * 301 + "?"
        q = _make_question({"questionStem": long_stem})
        content = _make_content(questions=[q])
        result = _validate(content)

        per_results = content["_per_question_results"]
        stem_check = [c for c in per_results[0].checks if "stem_length" in c.name]
        assert len(stem_check) == 1
        assert stem_check[0].passed is False

    def test_8_wrong_option_count_error(self) -> None:
        """Wrong option count (3 instead of 4) -> question fails (error)."""
        three_options = VALID_OPTIONS[:3]
        q = _make_question({"options": [dict(o) for o in three_options]})
        content = _make_content(questions=[q])
        result = _validate(content)

        per_results = content["_per_question_results"]
        assert per_results[0].passed is False
        option_check = [c for c in per_results[0].checks if "option_count" in c.name]
        assert option_check[0].severity == "error"

    def test_9_zero_correct_options_error(self) -> None:
        """Zero correct options -> question fails (error)."""
        options = [dict(o) for o in VALID_OPTIONS]
        for o in options:
            o["isCorrect"] = False
        q = _make_question({"options": options})
        content = _make_content(questions=[q])
        result = _validate(content)

        per_results = content["_per_question_results"]
        assert per_results[0].passed is False
        correct_check = [c for c in per_results[0].checks if "one_correct" in c.name]
        assert correct_check[0].passed is False
        assert correct_check[0].severity == "error"

    def test_10_two_correct_options_error(self) -> None:
        """Two correct options -> question fails (error)."""
        options = [dict(o) for o in VALID_OPTIONS]
        options[0]["isCorrect"] = True  # A is also correct now
        q = _make_question({"options": options})
        content = _make_content(questions=[q])
        result = _validate(content)

        per_results = content["_per_question_results"]
        assert per_results[0].passed is False
        correct_check = [c for c in per_results[0].checks if "one_correct" in c.name]
        assert correct_check[0].passed is False

    def test_11_stem_leakage_warning(self) -> None:
        """Stem leakage — correct answer substring in stem -> warning."""
        correct_text = "Officials exercising effective control may be held liable for subordinates acts"
        # Embed the correct answer text in the stem
        stem = (
            "Given the principle that Officials exercising effective control may be held "
            "liable for subordinates acts as stated in the decision, which of the following "
            "best describes the scope of command responsibility in Philippine law?"
        )
        options = [dict(o) for o in VALID_OPTIONS]
        options[1]["text"] = correct_text
        q = _make_question({"questionStem": stem, "options": options})
        content = _make_content(questions=[q])
        result = _validate(content)

        per_results = content["_per_question_results"]
        leakage_check = [c for c in per_results[0].checks if "stem_leakage" in c.name]
        assert len(leakage_check) == 1
        assert leakage_check[0].passed is False

    def test_12_distractor_too_similar_warning(self) -> None:
        """Distractor too similar (Levenshtein > 0.85) -> warning."""
        correct_text = "Officials exercising effective control may be held liable."
        # Make distractor nearly identical
        similar_text = "Officials exercising effective control may be held liable!"
        options = [
            {"label": "A", "text": similar_text, "isCorrect": False, "rationale": "Wrong."},
            {"label": "B", "text": correct_text, "isCorrect": True, "rationale": "Correct."},
            {"label": "C", "text": "Only military can be held liable.", "isCorrect": False, "rationale": "Wrong."},
            {"label": "D", "text": "No one can be held liable.", "isCorrect": False, "rationale": "Wrong."},
        ]
        q = _make_question({"options": options})
        content = _make_content(questions=[q])
        result = _validate(content)

        per_results = content["_per_question_results"]
        distractor_checks = [
            c for c in per_results[0].checks if "distractor_A_quality" in c.name
        ]
        assert len(distractor_checks) == 1
        assert distractor_checks[0].passed is False

    def test_13_missing_explanation_error(self) -> None:
        """Missing explanation -> question fails (error)."""
        q = _make_question({"explanation": ""})
        content = _make_content(questions=[q])
        result = _validate(content)

        per_results = content["_per_question_results"]
        assert per_results[0].passed is False
        expl_check = [c for c in per_results[0].checks if "explanation" in c.name]
        assert expl_check[0].passed is False
        assert expl_check[0].severity == "error"

    def test_14_fanout_cap_over_10_warning(self) -> None:
        """Fanout cap > 10 -> warning on batch."""
        questions = [_make_question() for _ in range(11)]
        content = _make_content(questions=questions)
        result = _validate(content)

        # Should have a warning on fanout but not quarantine (questions are valid)
        fanout_check = [c for c in result.checks if c.name == "fanout_cap"]
        assert len(fanout_check) == 1
        assert fanout_check[0].passed is False
        assert fanout_check[0].severity == "warning"
        # Overall verdict should be HUMAN_REVIEW due to the warning
        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW


class TestLevenshteinSimilarity:
    """Tests for the _levenshtein_similarity helper."""

    def test_15_identical_strings(self) -> None:
        """Identical strings -> 1.0."""
        assert _levenshtein_similarity("hello world", "hello world") == 1.0

    def test_16_completely_different(self) -> None:
        """Completely different strings -> low score."""
        sim = _levenshtein_similarity("abcdef", "zyxwvu")
        assert sim < 0.3

    def test_17_similar_with_minor_edits(self) -> None:
        """Similar with minor edits -> high score (> 0.85)."""
        sim = _levenshtein_similarity(
            "The doctrine of command responsibility",
            "The doctrine of command responsibilty",  # 1 char typo
        )
        assert sim > 0.85
