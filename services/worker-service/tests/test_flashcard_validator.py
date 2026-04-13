"""Tests for FlashcardValidator (PR 5.3).

10 tests covering:
1. Happy path — 5 valid cards -> PUBLISH
2. Abstain -> QUARANTINE
3. No cards -> QUARANTINE
4. Front too short (< 5 words) -> warning (HUMAN_REVIEW)
5. Front too long (> 200 words) -> warning (HUMAN_REVIEW)
6. Back empty -> error (QUARANTINE)
7. Fanout cap > 10 -> warning (HUMAN_REVIEW)
8. Missing supportingSectionIds -> warning (HUMAN_REVIEW)
9. Invalid section ID -> warning (HUMAN_REVIEW)
10. Card with all fields valid -> passes
"""

from __future__ import annotations

import pytest

from src.validators.derivative_validators import (
    DerivativeVerdict,
    LegalDocumentSectionSnapshot,
    LegalDocumentSnapshot,
)
from src.validators.derivative_validators.flashcard_validator import (
    FlashcardValidator,
)

# ---------------------------------------------------------------------------
# Fixtures & Helpers
# ---------------------------------------------------------------------------

FAKE_SOURCE_DOC = LegalDocumentSnapshot(
    id="doc-001",
    title="Republic v. Sandiganbayan",
    document_type="case",
    citation_text="G.R. No. 123456",
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
            "who hold positions of authority in the government."
        ),
        page_start=1,
        page_end=5,
    ),
    LegalDocumentSectionSnapshot(
        id="sec-002",
        section_type="body",
        plain_text="WHEREFORE, the petition is GRANTED.",
        page_start=5,
        page_end=6,
    ),
]


def _make_valid_card(index: int = 0) -> dict:
    """Create a valid flashcard dict."""
    return {
        "front": f"What is the doctrine of command responsibility as applied to civilian officials in Philippine law?",
        "back": (
            "The doctrine of command responsibility applies to civilian officials "
            "who hold positions of authority in the government. Officials with "
            "effective control over subordinates may be held liable for acts committed "
            "by those subordinates."
        ),
        "mnemonicHint": None,
        "supportingSectionIds": ["sec-001"],
    }


def _make_content(overrides: dict | None = None) -> dict:
    base = {
        "cards": [_make_valid_card(i) for i in range(5)],
        "abstain": False,
        "abstainReason": None,
    }
    if overrides:
        base.update(overrides)
    return base


def _validate(content: dict) -> object:
    validator = FlashcardValidator()
    return validator.validate(
        derivative_type="flashcard",
        content=content,
        source_document=FAKE_SOURCE_DOC,
        source_sections=FAKE_SECTIONS,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestFlashcardValidator:
    """Tests for the FlashcardValidator."""

    def test_1_happy_path_publish(self) -> None:
        """5 valid cards -> PUBLISH."""
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

    def test_3_no_cards_quarantine(self) -> None:
        """No cards -> QUARANTINE."""
        content = _make_content({"cards": []})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.QUARANTINE
        assert any("no cards" in r.lower() for r in result.reasons)

    def test_4_front_too_short_warning(self) -> None:
        """Front < 5 words -> warning (HUMAN_REVIEW)."""
        card = _make_valid_card()
        card["front"] = "Short front"  # 2 words
        content = _make_content({"cards": [card]})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("front" in r and "2 words" in r for r in result.reasons)

    def test_5_front_too_long_warning(self) -> None:
        """Front > 200 words -> warning (HUMAN_REVIEW)."""
        card = _make_valid_card()
        card["front"] = "word " * 201
        content = _make_content({"cards": [card]})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("201 words" in r for r in result.reasons)

    def test_6_back_empty_quarantine(self) -> None:
        """Back empty -> error (QUARANTINE)."""
        card = _make_valid_card()
        card["back"] = ""
        content = _make_content({"cards": [card]})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.QUARANTINE
        assert any("back" in r and "empty" in r for r in result.reasons)

    def test_7_fanout_cap_warning(self) -> None:
        """More than 10 cards -> warning (HUMAN_REVIEW)."""
        content = _make_content({"cards": [_make_valid_card(i) for i in range(11)]})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("11 cards" in r and "max 10" in r for r in result.reasons)

    def test_8_missing_section_ids_warning(self) -> None:
        """Missing supportingSectionIds -> warning (HUMAN_REVIEW)."""
        card = _make_valid_card()
        card["supportingSectionIds"] = []
        content = _make_content({"cards": [card]})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("no supportingSectionIds" in r for r in result.reasons)

    def test_9_invalid_section_id_warning(self) -> None:
        """Invalid section ID -> warning (HUMAN_REVIEW)."""
        card = _make_valid_card()
        card["supportingSectionIds"] = ["nonexistent-section-id"]
        content = _make_content({"cards": [card]})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("not in source" in r for r in result.reasons)

    def test_10_valid_card_passes(self) -> None:
        """Single card with all fields valid -> PUBLISH."""
        content = _make_content({"cards": [_make_valid_card()]})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.PUBLISH
        assert len(result.reasons) == 0
