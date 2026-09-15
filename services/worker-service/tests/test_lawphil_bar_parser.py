"""Unit tests for the LawPhil past-bar-exam HTML parser.

Fixtures are real LawPhil pages saved on 2026-04-27 to
``tests/fixtures/lawphil_bar/``. Tests do NOT hit the network — they
exercise only the parser logic against frozen HTML.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from bs4 import BeautifulSoup

from src.parsers.lawphil_bar_html import (
    ParsedBarQuestion,
    _collect_content_blocks,
    _count_sub_parts,
    _instruction_region,
    _parse_numbered_format,
    parse,
    parse_page,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "lawphil_bar"


def _load(filename: str) -> str:
    """Load a fixture under windows-1252 (LawPhil's native encoding)."""
    raw = (FIXTURES_DIR / filename).read_bytes()
    return raw.decode("windows-1252", errors="replace")


#: The exact number of questions each fixture parses to, and the format it
#: is parsed under. Exact, not a floor: the 2015 breakage was a parse that
#: silently dropped from 22 questions to 4 instruction paragraphs, and a
#: ">= 14" assertion is blind to precisely that. Changing a number here means
#: a real page is being read differently than it was — justify it, do not
#: update it to match.
EXPECTED_PARSE: dict[str, tuple[str, int]] = {
    "2006_civil.html": ("roman", 16),
    "2018_criminal.html": ("roman", 19),
    "2022_civil_I.html": ("numbered", 15),
    "2022_political.html": ("numbered", 15),
    "2015_criminal.html": ("ordered_list", 22),
}


@pytest.mark.parametrize("fixture", sorted(EXPECTED_PARSE))
def test_fixture_parses_to_its_exact_count_and_format(fixture: str) -> None:
    page = parse_page(_load(fixture))
    expected_format, expected_count = EXPECTED_PARSE[fixture]
    assert len(page.questions) == expected_count, (
        f"{fixture}: parsed {len(page.questions)}, expected exactly "
        f"{expected_count}"
    )
    assert page.page_format == expected_format


@pytest.mark.parametrize(
    "fixture,expected_format,min_questions",
    [
        ("2006_civil.html", "roman", 14),
        ("2018_criminal.html", "roman", 15),
        ("2022_civil_I.html", "numbered", 10),
        ("2022_political.html", "numbered", 10),
        ("2015_criminal.html", "ordered_list", 20),
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
        "2015_criminal.html",
    ):
        questions = parse(_load(fixture))
        numbers = [q.question_number for q in questions]
        assert len(numbers) == len(set(numbers)), (
            f"{fixture}: duplicate question numbers: {numbers}"
        )


# ---------------------------------------------------------------------------
# The 2015 ordered-list format: <ol type="I"> with browser-drawn numerals,
# malformed sub-part nesting, and no Roman numeral anywhere in the text.
# ---------------------------------------------------------------------------


class TestOrderedListFormat:
    def test_2015_criminal_parses_every_item(self) -> None:
        """22 items, numbered 1..22, in page order.

        Prod stored 4 for this sitting — the instruction paragraphs — because
        the page has no Roman text markers and fell through to the numbered
        parser.
        """
        page = parse_page(_load("2015_criminal.html"))

        assert page.page_format == "ordered_list"
        assert len(page.questions) == 22
        assert [q.question_number for q in page.questions] == list(range(1, 23))

    def test_expected_items_is_read_off_the_instructions(self) -> None:
        """"There are 22 items (I to XXII)" — the page's own count.

        This is the only number on the page that can contradict the parse,
        which is what makes a silent 22 → 4 regression detectable at all.
        """
        assert parse_page(_load("2015_criminal.html")).expected_items == 22

    def test_no_question_is_an_instruction_paragraph(self) -> None:
        """The four paragraphs prod stored as questions must not come back."""
        questions = parse(_load("2015_criminal.html"))

        for q in questions:
            lowered = q.question_text.lower()
            assert not lowered.startswith("this questionnaire contains")
            assert not lowered.startswith("read each question")
            assert not lowered.startswith("answer legibly")
            assert not lowered.startswith("there are ")

    def test_sub_parts_inside_a_malformed_dir_reach_the_question_text(
        self,
    ) -> None:
        """The a)/b) sub-parts of the malformed items are part of the body.

        An item whose sub-parts were dropped would be a question with no
        question in it — the fact pattern alone.
        """
        questions = parse(_load("2015_criminal.html"))
        with_sub_parts = [q for q in questions if q.sub_parts_count >= 2]

        assert with_sub_parts, "expected at least one multi-part item"
        for q in with_sub_parts:
            assert "a)" in q.question_text
            assert "b)" in q.question_text

    def test_every_question_carries_a_real_body(self) -> None:
        questions = parse(_load("2015_criminal.html"))
        for q in questions:
            assert len(q.question_text) >= 50, (
                f"question {q.question_number} is a fragment: "
                f"{q.question_text!r}"
            )


class TestLxmlRepairsTheMalformedNesting:
    """What lxml actually does with ``</li>`` written inside ``<dir>``.

    The 2015 pages close the list item from inside a ``<dir>`` and leave the
    ``</dir>`` stranded after it. The parser's correctness rests on how that
    is repaired, so the behaviour is pinned here rather than assumed: if a
    future lxml/bs4 release re-nests it differently, this fails first and
    explains why the item bodies changed.
    """

    MALFORMED = (
        '<html><body><ol type="I">'
        '<li><p align="justify">First item body.</p></li>'
        '<li><p align="justify">Second item body.'
        "<dir>"
        '<p align="justify">a) sub part one</p>'
        '<p align="justify">b) sub part two</p></li>'
        "</dir>"
        '<li><p align="justify">Third item body.</p></li>'
        "</ol></body></html>"
    )

    def test_the_dir_is_pulled_inside_the_item_that_opened_it(self) -> None:
        soup = BeautifulSoup(self.MALFORMED, "lxml")
        ol = soup.find("ol")
        items = ol.find_all("li", recursive=False)

        # Three items, not two and not four: the stray </dir> is discarded
        # rather than closing anything.
        assert len(items) == 3
        # The <dir> ends up a CHILD of the second item…
        dir_tag = soup.find("dir")
        assert dir_tag.parent.name == "li"
        assert dir_tag.parent is items[1]
        # …so the sub-parts are already in the item's text, with no sibling
        # collection needed for this shape.
        assert "a) sub part one" in items[1].get_text(" ", strip=True)
        assert "b) sub part two" in items[1].get_text(" ", strip=True)
        # And they did not leak into the item after it.
        assert "sub part" not in items[2].get_text(" ", strip=True)

    def test_content_after_a_well_formed_li_stays_a_sibling(self) -> None:
        """The other half of the rule: a <p> after </li> is NOT in the item.

        This is why each item also absorbs the non-<li> siblings that follow
        it — without that, these sub-parts would belong to nothing.
        """
        html = (
            '<html><body><ol type="I">'
            "<li><p>First item body, long enough to be a real question.</p></li>"
            "<p>a) trailing sub-part one</p>"
            "<dir><p>b) trailing sub-part two</p></dir>"
            "<li><p>Second item body, which is also long enough to count as one.</p></li>"
            "</ol></body></html>"
        )
        soup = BeautifulSoup(html, "lxml")
        items = soup.find("ol").find_all("li", recursive=False)
        assert "trailing sub-part" not in items[0].get_text(" ", strip=True)

        page = parse_page(html)
        assert len(page.questions) == 2
        assert "a) trailing sub-part one" in page.questions[0].question_text
        assert "b) trailing sub-part two" in page.questions[0].question_text
        assert "trailing" not in page.questions[1].question_text

    def test_a_nested_list_does_not_become_its_own_questions(self) -> None:
        """Sub-part lists are counted, not promoted to items."""
        html = (
            '<html><body><ol type="I">'
            "<li><p>First item body, long enough to be a real question.</p>"
            "<ol><li>sub a</li><li>sub b</li></ol></li>"
            "<li><p>Second item body, which is also long enough to count as one.</p></li>"
            "</ol></body></html>"
        )
        page = parse_page(html)
        assert [q.question_number for q in page.questions] == [1, 2]
        assert page.questions[0].sub_parts_count == 2


class TestExpectedItems:
    def test_absent_declaration_is_none(self) -> None:
        assert parse_page(_load("2006_civil.html")).expected_items is None

    def test_the_2022_phrasing_is_also_recognised(self) -> None:
        """"…consisting of 15 items" — same declaration, different sentence."""
        assert parse_page(_load("2022_civil_I.html")).expected_items == 15

    def test_the_real_2015_sentence_parses_despite_its_typos(self) -> None:
        """The live page's sentence is malformed, verbatim:

            "There are 22 items (I to XXII to be answered within/our (4) hours."

        The parenthetical is never closed and "within four" is typo'd as
        "within/our". The count is still the examiner's own, so the pattern
        anchors on "There are 22 items" and reads nothing after it — a regex
        that required a closed "(I to XXII)" would return None on the one page
        this whole branch exists for.
        """
        html = (
            "<html><body>"
            "<p align='justify'>4. There are 22 items (I to XXII to be "
            "answered within/our (4) hours. Do not explain your answers.</p>"
            "</body></html>"
        )
        assert parse_page(html).expected_items == 22

    @pytest.mark.parametrize(
        "sentence",
        [
            "There are 22 items (I to XXII) to be answered within four hours.",
            "There are 22 items (I to XXII to be answered within/our (4) hours.",
            "There are 22 items to be answered within four (4) hours.",
            "there are 22 items",
            "There are twenty-two (22) items to be answered.",
        ],
    )
    def test_every_phrasing_of_the_count_sentence_reads_22(
        self, sentence: str
    ) -> None:
        html = f"<html><body><p>{sentence}</p></body></html>"
        assert parse_page(html).expected_items == 22

    def test_it_never_changes_the_parse(self) -> None:
        """A wrong declaration must not add or drop a question."""
        html = (
            "<html><body>"
            "<p>There are 99 items to be answered within four (4) hours.</p>"
            '<ol type="I">'
            "<li><p>First item body, long enough to be a real question.</p></li>"
            "<li><p>Second item body, which is also long enough to count as one.</p></li>"
            "</ol></body></html>"
        )
        page = parse_page(html)
        assert page.expected_items == 99
        assert len(page.questions) == 2


class TestNumberedFormatNeverReturnsInstructions:
    """The guard for the failure this branch fixes, at its source.

    The ordered-list format means a 2015 page no longer reaches the numbered
    parser at all. That is a routing decision, and routing decisions can be
    re-broken by the next page shape LawPhil invents. This drives the
    numbered parser DIRECTLY with the 2015 page's blocks — the exact input it
    used to receive — and requires that it refuses to emit instructions.
    """

    def test_the_old_code_path_now_returns_no_instruction_questions(
        self,
    ) -> None:
        soup = BeautifulSoup(_load("2015_criminal.html"), "lxml")
        blocks = _collect_content_blocks(soup)

        questions = _parse_numbered_format(blocks)

        assert questions == [], (
            "the numbered parser found questions on a list-format page: "
            f"{[q.question_text[:60] for q in questions]}"
        )

    @pytest.mark.parametrize(
        "text",
        [
            "1. This Questionnaire contains eleven (11) pages. Check the "
            "number of pages and their proper sequencing.",
            "2. Read each question very carefully and write your answers in "
            "your Bar Examination Notebook in the same order.",
            "3. Answer legibly, clearly and concisely. Start each number on a "
            "separate page and write continuously.",
            "4. There are 22 items (I to XXII) to be answered within four (4) "
            "hours. Do not explain your answers.",
        ],
    )
    def test_each_instruction_line_is_refused(self, text: str) -> None:
        html = (
            "<html><body>"
            f"<p align='justify'>{text}</p>"
            # A second numbered paragraph, so the page reads as the numbered
            # format at all — and also an instruction, so nothing survives.
            "<p align='justify'>5. Answer each question on a separate page and "
            "write continuously until the answer is completed.</p>"
            "</body></html>"
        )
        assert parse(html) == []

    def test_a_real_question_mentioning_instructions_still_parses(self) -> None:
        """The check reads the OPENING of a body, not the whole of it."""
        html = (
            "<html><body>"
            "<p>1. Atty. Reyes told the examinee to read each question very "
            "carefully before answering. Was his advice improper? (5%)</p>"
            "<p>2. Bartolome shot a man he mistook for a robber inside the "
            "compound he was guarding. Discuss his liability. (5%)</p>"
            "</body></html>"
        )
        questions = parse(html)
        assert len(questions) == 2
        assert questions[0].question_text.startswith("1. Atty. Reyes")


# ---------------------------------------------------------------------------
# _count_sub_parts: explicit "[This item has N questions]" marker overrides
# the inline-letter heuristic. See 2022 Civil Law Q6 (lease terms i/ii/iii
# inside the fact pattern, but only TWO genuine sub-questions).
# ---------------------------------------------------------------------------


def test_count_sub_parts_explicit_marker_overrides_inline_roman_lowercase() -> None:
    """Bracketed declaration ('[This item has two questions.]') beats the
    inline ``(i)/(ii)/(iii)`` markers that LawPhil sometimes uses to
    enumerate facts (lease terms, contract clauses, etc.) inside a question
    body. The examiner's explicit count is ground truth.
    """
    body = (
        "Pedro leased his property to Juan under the following terms: "
        "(i) monthly rent of P10,000; (ii) a two-year fixed term; and "
        "(iii) automatic renewal absent thirty days' written notice. "
        "[This item has two questions.] "
        "(a) Is the renewal clause enforceable? "
        "(b) May Pedro unilaterally raise the rent during the term?"
    )
    assert _count_sub_parts(body, []) == 2


def test_count_sub_parts_explicit_marker_with_digit_form() -> None:
    """The marker also accepts a digit, e.g. '[This item has 3 questions.]'."""
    body = (
        "Facts: A, B, and C are co-owners of a parcel of land. "
        "[This item has 3 questions.] "
        "Discuss the rights of each co-owner."
    )
    assert _count_sub_parts(body, []) == 3


def test_count_sub_parts_explicit_marker_is_case_insensitive() -> None:
    """Match regardless of the casing LawPhil happens to use."""
    body = (
        "Facts: D borrowed money from E. "
        "[THIS ITEM HAS FOUR QUESTIONS.] "
        "Sub-parts follow."
    )
    assert _count_sub_parts(body, []) == 4


def test_count_sub_parts_no_marker_falls_through_to_heuristic() -> None:
    """Regression: with no bracket declaration, the existing (a)/(b)
    heuristic still produces the correct count for legitimately
    multi-part questions.
    """
    body = (
        "Facts: ABC Corp. dismissed its general manager without notice. "
        "(a) Was the dismissal valid? "
        "(b) What damages, if any, may the manager recover?"
    )
    assert _count_sub_parts(body, []) == 2


def test_count_sub_parts_no_marker_inline_roman_enumeration_still_counted() -> None:
    """Without an explicit marker, an inline ``(a)/(b)`` set is still the
    signal we have — preserve the pre-existing behaviour so the fix is
    strictly additive.
    """
    body = (
        "Facts: X executed a will with the following clauses: "
        "(a) bequest to spouse; (b) bequest to son. "
        "Discuss the validity of each clause."
    )
    assert _count_sub_parts(body, []) == 2
class TestInstructionRegion:
    """The structural rule that keeps the preamble out of the question set.

    ``_looks_like_instructions`` matches a fixed list of opening phrases, and
    the real 2015 page walked straight past two of them ("3. Answer the Essay
    questions legibly…" is not "answer legibly"; "4. Make sure you do not
    write your name…" is not "do not write your name"). A phrase list can
    only ever be as complete as the pages we have already read, so the
    primary defence is positional: the preamble is whatever sits under the
    page's own INSTRUCTIONS heading.
    """

    def test_it_claims_the_whole_2015_preamble(self) -> None:
        blocks = _collect_content_blocks(
            BeautifulSoup(_load("2015_criminal.html"), "lxml"),
        )
        region = _instruction_region(blocks)

        claimed = [blocks[i].text for i in sorted(region)]
        assert claimed[0] == "INSTRUCTIONS"
        # Both paragraphs the phrase list missed, and the chairperson footer
        # that the last of them used to swallow.
        assert any(t.startswith("3. Answer the Essay questions") for t in claimed)
        assert any(t.startswith("4. Make sure you do not write") for t in claimed)
        assert any("LEONARDO-DE CASTRO" in t for t in claimed)
        # …and it stops at the <ol>: no question body is claimed.
        assert not any("How are felonies committed" in t for t in claimed)

    def test_it_stops_where_2022_numbering_restarts(self) -> None:
        """Instructions 1..10 then questions 1..15 — the restart is the edge."""
        blocks = _collect_content_blocks(
            BeautifulSoup(_load("2022_civil_I.html"), "lxml"),
        )
        region = _instruction_region(blocks)

        claimed = [blocks[i].text for i in sorted(region)]
        assert claimed[0] == "INSTRUCTIONS"
        assert any(t.startswith("10. ") for t in claimed)
        assert not any(t.startswith("1. Noel is the son") for t in claimed)
        assert len(parse_page(_load("2022_civil_I.html")).questions) == 15

    def test_a_page_without_the_heading_claims_nothing(self) -> None:
        blocks = _collect_content_blocks(
            BeautifulSoup(
                "<html><body><p>1. Some paragraph long enough to be a body.</p>"
                "<p>2. Another paragraph long enough to be a body too.</p>"
                "</body></html>",
                "lxml",
            ),
        )
        assert _instruction_region(blocks) == set()

    def test_it_refuses_to_swallow_a_page_with_no_question_list(self) -> None:
        """A heading whose numbered run never terminates would otherwise
        claim every paragraph and return an empty paper. Claim the heading
        only and let the lexical net decide.
        """
        blocks = _collect_content_blocks(
            BeautifulSoup(
                "<html><body><p align='center'><b>INSTRUCTIONS</b></p>"
                "<p>1. First paragraph, long enough to pass the body check.</p>"
                "<p>2. Second paragraph, also long enough to pass the check.</p>"
                "</body></html>",
                "lxml",
            ),
        )
        assert _instruction_region(blocks) == {0}
