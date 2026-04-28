"""Unit tests for the LawPhil past-bar-exam HTML parser.

Fixtures are real LawPhil pages saved on 2026-04-27 to
``tests/fixtures/lawphil_bar/``. Tests do NOT hit the network — they
exercise only the parser logic against frozen HTML.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from src.parsers.lawphil_bar_html import ParsedBarQuestion, parse

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "lawphil_bar"


def _load(filename: str) -> str:
    """Load a fixture under windows-1252 (LawPhil's native encoding)."""
    raw = (FIXTURES_DIR / filename).read_bytes()
    return raw.decode("windows-1252", errors="replace")


@pytest.mark.parametrize(
    "fixture,expected_format,min_questions",
    [
        ("2006_civil.html", "roman", 14),
        ("2018_criminal.html", "roman", 15),
        ("2022_civil_I.html", "numbered", 10),
        ("2022_political.html", "numbered", 10),
    ],
)
def test_parses_questions_from_each_format(
    fixture: str,
    expected_format: str,  # noqa: ARG001 — recorded for readability
    min_questions: int,
) -> None:
    """Each fixture parses to a non-trivial set of questions."""
    html = _load(fixture)
    questions = parse(html)
    assert len(questions) >= min_questions, (
        f"{fixture}: expected ≥{min_questions} questions, got {len(questions)}"
    )
    # All entries must be the dataclass type with the right fields.
    assert all(isinstance(q, ParsedBarQuestion) for q in questions)
    # Question numbers must be a strictly-increasing sequence starting at 1.
    numbers = [q.question_number for q in questions]
    assert numbers == sorted(numbers), (
        f"{fixture}: question numbers not in order: {numbers}"
    )
    assert numbers[0] == 1, (
        f"{fixture}: first question number is {numbers[0]}, expected 1"
    )


def test_2006_civil_uses_roman_marker_format() -> None:
    """The 2006 civil paper opens with Article 213 / child custody."""
    questions = parse(_load("2006_civil.html"))
    q1 = questions[0]
    assert q1.question_number == 1
    assert "Article 213" in q1.question_text
    assert "Family Code" in q1.question_text
    # Question I has 2 sub-parts (1: rationale, 2: examples).
    assert q1.sub_parts_count == 2


def test_2006_civil_carries_sub_parts_into_question_body() -> None:
    """Sub-part question text must be embedded in question_text verbatim."""
    questions = parse(_load("2006_civil.html"))
    q1 = questions[0]
    assert "Explain the rationale" in q1.question_text
    assert "compelling reasons" in q1.question_text


def test_2018_criminal_uses_dashless_roman_marker() -> None:
    """2018 papers use ``<p align="center">I</p>`` (no surrounding dashes)."""
    questions = parse(_load("2018_criminal.html"))
    assert len(questions) >= 15
    # Every question_text must be a substantial body, not a stray fragment.
    for q in questions:
        assert len(q.question_text) >= 50, (
            f"Question {q.question_number} too short: {q.question_text!r}"
        )


def test_2022_civil_I_uses_numbered_format() -> None:
    """The 2022 Civil Law I paper opens with Noel's 7th birthday scenario."""
    questions = parse(_load("2022_civil_I.html"))
    assert len(questions) >= 10
    q1 = questions[0]
    assert q1.question_number == 1
    assert "Noel" in q1.question_text
    # The "What is your advice?" interrogative must be in the body.
    assert "advice" in q1.question_text.lower()


def test_2022_political_law_carries_sub_parts() -> None:
    """The 2022 political-law paper has at least one item with (a)/(b)
    sub-questions — we should detect sub_parts_count >= 2 on it.
    """
    questions = parse(_load("2022_political.html"))
    # At least one question in the paper has 2+ sub-parts.
    multi_part = [q for q in questions if q.sub_parts_count >= 2]
    assert multi_part, (
        "Expected at least one question with sub_parts_count >= 2 in "
        "2022_political.html (item 4 has (a) and (b))"
    )


def test_empty_html_returns_empty_list() -> None:
    """Defensive: malformed/empty input is a no-op, not an exception."""
    assert parse("") == []
    assert parse("<html><body></body></html>") == []


def test_unknown_format_returns_empty_list() -> None:
    """A page with no Roman markers and no numbered paragraphs returns []."""
    html = "<html><body><p>This is not a bar exam page.</p></body></html>"
    assert parse(html) == []


def test_question_numbers_are_unique_within_a_sitting() -> None:
    """The unique-key contract for bar_exam_questions requires no dupes."""
    for fixture in (
        "2006_civil.html",
        "2018_criminal.html",
        "2022_civil_I.html",
        "2022_political.html",
    ):
        questions = parse(_load(fixture))
        numbers = [q.question_number for q in questions]
        assert len(numbers) == len(set(numbers)), (
            f"{fixture}: duplicate question numbers: {numbers}"
        )
