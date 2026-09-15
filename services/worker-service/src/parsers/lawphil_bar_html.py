"""LIBERTASIAN Worker Service — LawPhil past bar exam questions parser.

Parses LawPhil archive pages of past Philippine Bar examinations
(2006-2022) into structured ``ParsedBarQuestion`` rows.

LawPhil hosts two distinct page formats:

1. **Legacy format (2006-2018, plus 2019-2021 if available)** — questions are
   labelled by Roman numerals inside ``<p align="center">`` markers, e.g.::

       <p align="center">- I -</p>           (2006-style, with dashes)
       <p align="center">I</p>               (2018-style, no dashes)
       <p align="justify">[scenario text]</p>
       <ol>
         <li><p align="justify">[sub-part]</p></li>
         <li><p align="justify">[sub-part]</p></li>
       </ol>

2. **2022 format** — questions are flat-numbered (``1.``, ``2.``, …) inside
   paragraphs of class ``jn``, with the actual question/interrogative
   often in a final ``jn b`` (bold) paragraph. Sub-parts appear inline as
   ``(a)``, ``(b)``, etc. Some 2022 papers also use ``PART A`` / ``PART B``
   section headers, which we treat as ignored separators.

3. **Ordered-list format (2015)** — there is no numeral anywhere in the
   *text*: the page hands numbering to the browser with
   ``<ol type="I">`` and one ``<li>`` per item::

       <ol type="I">
         <li><p align="justify">a) How are felonies committed? (3%)</p>
             <p align="justify">b) What is aberratio ictus? (2%)</p></li>
         <li><p align="justify">The RTC found Tiburcio guilty …
             <dir>
             <p align="justify">a) Should the RTC grant …? (2.5%)</p></li>
             </dir>
       </ol>

   Note the malformed nesting in the second item — ``</li>`` appears
   *inside* ``<dir>``, and the ``</dir>`` after it is stray. lxml repairs
   this by moving the whole ``<dir>`` inside the ``<li>`` it opened in and
   closing the item there, so ``li.get_text()`` already carries the
   sub-parts; ``tests/test_lawphil_bar_parser.py`` pins that behaviour
   rather than trusting it. The sub-parts do NOT always end up inside the
   ``<li>``, though: when a ``<p>`` or ``<dir>`` follows a well-formed
   ``</li>`` it stays a *sibling* inside the ``<ol>``, so each item also
   absorbs the non-``<li>`` siblings that follow it up to the next ``<li>``.

   Before this format existed, such a page fell through to the numbered
   parser, which found no ``<ol>`` content at all and instead took the
   ``1.``/``2.``/``3.``/``4.`` INSTRUCTION paragraphs as its questions —
   which is how five 2015 sittings on prod came to hold four "questions"
   apiece reading "This Questionnaire contains …". ``_instruction_region``
   now makes that specific failure impossible rather than merely unlikely:
   the numbered parser excises the preamble by its position under the page's
   own ``INSTRUCTIONS`` heading, so no wording LawPhil chooses can smuggle an
   instruction through. ``_looks_like_instructions`` stays behind it as a
   lexical net for pages that carry no such heading.

All three formats are decoded under windows-1252 (LawPhil's native
encoding). The caller is responsible for handing us already-decoded text.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from bs4 import BeautifulSoup, Tag

logger = logging.getLogger(__name__)

# Minimum body length (chars) before we accept a paragraph block as a
# legitimate question body. Anything shorter is almost certainly a
# header / fragment / page artifact.
_MIN_QUESTION_BODY_CHARS = 50

# Roman numeral regex (I, II, III, IV, V, VI, ... XX, XXI, ...). Anchored.
# Tolerates surrounding whitespace and dash decorations like "- I -".
_ROMAN_MARKER_RE = re.compile(
    r"^[\s\-\u2013\u2014\.]*"
    r"(?P<roman>M{0,4}(?:CM|CD|D?C{0,4})(?:XC|XL|L?X{0,4})(?:IX|IV|V?I{0,4}))"
    r"[\s\-\u2013\u2014\.]*$",
)

# Numbered-question marker (2022 format): paragraph starts with "<digit>. "
# at the very beginning, followed by a capital letter for the scenario lead.
# Allows sequence numbers up to 99 — well above the 15-item papers we have.
_NUMBERED_START_RE = re.compile(r"^(?P<num>\d{1,2})\.\s+(?P<rest>\S)")

# Section break markers (2022 format): "PART A", "PART B", or
# "-NOTHING FOLLOWS-" / "NOTHING FOLLOWS" tail.
_PART_MARKER_RE = re.compile(r"^PART\s+[A-Z]\b", re.IGNORECASE)
_END_MARKER_RE = re.compile(r"NOTHING\s+FOLLOWS", re.IGNORECASE)

# Roman → integer (handles up to XXXIX; bar papers don't exceed ~25 items).
_ROMAN_VALUES = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}

# Number-word → integer for the explicit "[This item has N questions.]"
# declaration that LawPhil sometimes embeds in the question body. Bar papers
# never enumerate more than ten sub-questions in a single item, so one..ten
# is sufficient coverage.
_WORD_TO_INT: dict[str, int] = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
}

# Explicit sub-part count declaration, e.g. "[This item has two questions.]"
# or "[This item has 3 questions]". Bracket characters are optional so that
# we still match if LawPhil drops them in a future edit. Case-insensitive.
_EXPLICIT_SUBPART_RE = re.compile(
    r"this item has\s+(?P<count>\w+)\s+questions?",
    re.IGNORECASE,
)

# The examiner's own item count, from the instruction block: "There are 22
# items (I to XXII) to be answered within four (4) hours." Also tolerates the
# spelled-out-with-digits style LawPhil uses elsewhere on the same pages
# ("There are twenty-two (22) items"). This is the page telling us how many
# questions it contains — the one number on it that can contradict the parse.
_EXPECTED_ITEMS_RE = re.compile(
    r"there\s+are\s+(?:[A-Za-z\-]+\s*)?\(?(?P<count>\d{1,3})\)?\s+items",
    re.IGNORECASE,
)

# The same declaration in 2022 phrasing: "This is a 4-hour examination
# consisting of 15 items, each worth 5 points." Both 2022 fixtures carry it
# and both agree with the parse, so recognising it gives the audit an
# independent expectation on those pages instead of a blank.
_EXPECTED_ITEMS_ALT_RE = re.compile(
    r"consisting\s+of\s+(?:[A-Za-z\-]+\s*)?\(?(?P<count>\d{1,3})\)?\s+items",
    re.IGNORECASE,
)

# Sub-part markers in the 2015 list format are bare "a)" / "b)", NOT the
# parenthesised "(a)" the other formats use, so they need their own pattern.
# Anchored to a segment start so a citation like "Art. 315 par. 2(a)" or a
# stray ")" inside prose cannot inflate the count.
_LIST_SUBPART_RE = re.compile(r"(?:^|[\s;])(?P<letter>[a-j])\)\s", re.IGNORECASE)

# Just the "12. " ordinal prefix, for stripping before an instruction check.
# _NUMBERED_START_RE cannot be reused for that: it captures the first
# character of the body too, so substituting it away would eat the letter the
# check is about to read.
_NUMBERED_PREFIX_RE = re.compile(r"^\d{1,2}\.\s+")

# The examiner's instruction block opens with a centred "INSTRUCTIONS"
# heading on every LawPhil paper we have (2015 and 2022 alike). That heading
# is the structural anchor for ``_instruction_region``: everything the parser
# needs to know about where the preamble starts is in the page's own markup,
# not in the wording of the sentences underneath it.
_INSTRUCTIONS_HEADER_RE = re.compile(r"^instructions?\s*:?$", re.IGNORECASE)

# Instruction-block openings. These are the sentences LawPhil puts in the
# numbered preamble of every paper; none of them can legitimately open a
# question. The numbered parser refuses to emit a body starting with one —
# see ``_looks_like_instructions``.
_INSTRUCTION_OPENINGS: tuple[str, ...] = (
    "this questionnaire contains",
    "this questionnaire is",
    "read each question",
    "answer legibly",
    "answer each question",
    "there are ",
    "you are given",
    "begin your answer",
    "write your answers",
    "do not write your name",
    "hand in your",
    "a mere",
    "good luck",
)


@dataclass(frozen=True)
class ParsedBarQuestion:
    """One numbered question parsed from a LawPhil bar exam page."""

    question_number: int
    question_text: str
    sub_parts_count: int = 0
    source_section_anchor: str | None = None


@dataclass(frozen=True)
class ParsedBarPage:
    """A parsed page: its questions, plus what the page said to expect.

    ``expected_items`` is the examiner's own count ("There are 22 items"),
    or ``None`` when the page does not state one. It is never used to alter
    the parse — it is the independent number a caller can hold the parse up
    against, which is the only reason the 2015 breakage was detectable at
    all: five sittings stored 4 questions on pages that said 22.
    """

    questions: list[ParsedBarQuestion]
    expected_items: int | None = None
    page_format: str | None = None


def parse(html: str) -> list[ParsedBarQuestion]:
    """Parse a LawPhil bar exam page into a list of structured questions.

    Returns an empty list if the page does not match any known format
    (e.g. answer-key page mistakenly fed in, or LawPhil HTML drift).
    """
    return parse_page(html).questions


def parse_page(html: str) -> ParsedBarPage:
    """Parse a page into questions plus the item count it declares.

    Format detection order is Roman text markers → ordered list → numbered,
    and the order is load-bearing in both directions:

    * Roman first, because 2018-era papers carry instruction paragraphs
      opening with a numeric "1." that would otherwise read as the 2022
      numbered format.
    * Ordered list before numbered, because a 2015 page has no Roman text
      markers at all (the numerals are drawn by the browser from
      ``<ol type="I">``) and would otherwise fall through to the numbered
      parser, which cannot see inside ``<ol>`` blocks and picks up the
      instruction paragraphs instead.
    """
    if not html or not html.strip():
        return ParsedBarPage(questions=[])

    soup = BeautifulSoup(html, "lxml")
    blocks = _collect_content_blocks(soup)
    if not blocks:
        return ParsedBarPage(questions=[])

    expected_items = _detect_expected_items(blocks)

    if _has_roman_markers(blocks):
        return ParsedBarPage(
            questions=_parse_roman_format(blocks),
            expected_items=expected_items,
            page_format="roman",
        )

    ordered_lists = _find_ordered_lists(blocks)
    if ordered_lists:
        return ParsedBarPage(
            questions=_parse_ordered_list_format(ordered_lists),
            expected_items=expected_items,
            page_format="ordered_list",
        )

    if _is_numbered_format(blocks):
        return ParsedBarPage(
            questions=_parse_numbered_format(blocks),
            expected_items=expected_items,
            page_format="numbered",
        )

    return ParsedBarPage(questions=[], expected_items=expected_items)


def _detect_expected_items(blocks: list[_Block]) -> int | None:
    """Return the item count the page declares, or None if it declares none.

    Only the first declaration counts: the phrase appears in the instruction
    block, and a later "there are 3 items" inside a fact pattern must not
    overwrite it.
    """
    for block in blocks:
        for pattern in (_EXPECTED_ITEMS_RE, _EXPECTED_ITEMS_ALT_RE):
            match = pattern.search(block.text)
            if match is not None:
                value = int(match.group("count"))
                if value > 0:
                    return value
    return None


def _has_roman_markers(blocks: list[_Block]) -> bool:
    """True when there are at least two distinct Roman-numeral question
    markers — this is the signature of the legacy LawPhil format and is
    a stronger signal than a stray "1." paragraph in the preamble.
    """
    seen: set[int] = set()
    for block in blocks:
        marker = _detect_roman_marker(block)
        if marker is not None:
            seen.add(marker)
            if len(seen) >= 2:
                return True
    return False


# ---------------------------------------------------------------------------
# Content extraction
# ---------------------------------------------------------------------------


@dataclass
class _Block:
    """A single content block (paragraph, list, or marker) in document order."""

    kind: str  # "p", "ol", "ul"
    text: str
    align: str
    css_class: str
    element: Tag = field(repr=False)


def _collect_content_blocks(soup: BeautifulSoup) -> list[_Block]:
    """Return all top-level content blocks within the body, in order.

    Skips blocks nested inside other ``<p>``/``<li>``/``<ol>`` so we do not
    double-count sub-part text alongside its parent question.
    """
    body = soup.body or soup
    blocks: list[_Block] = []
    for elem in body.find_all(["p", "ol", "ul"]):
        if not isinstance(elem, Tag):
            continue
        # Skip elements nested inside another paragraph or list item — we
        # capture those via the parent's text content.
        if _has_block_ancestor(elem):
            continue
        text = elem.get_text(" ", strip=True)
        if not text:
            continue
        # Normalize internal whitespace (NBSP, multiple spaces, tabs).
        text = _normalize_whitespace(text)
        raw_class = elem.get("class")
        css_class_list = list(raw_class) if isinstance(raw_class, list) else []
        blocks.append(
            _Block(
                kind=elem.name,
                text=text,
                align=str(elem.get("align", "")),
                css_class=" ".join(css_class_list),
                element=elem,
            ),
        )
    return blocks


def _has_block_ancestor(elem: Tag) -> bool:
    """True if ``elem`` is inside a <p>, <li>, or another <ol>/<ul>."""
    parent = elem.parent
    while parent is not None and isinstance(parent, Tag):
        if parent.name in ("p", "li", "ol", "ul"):
            return True
        parent = parent.parent
    return False


def _normalize_whitespace(text: str) -> str:
    """Collapse runs of whitespace (including NBSP) to a single space."""
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


# ---------------------------------------------------------------------------
# Format detection
# ---------------------------------------------------------------------------


def _is_numbered_format(blocks: list[_Block]) -> bool:
    """The 2022 format has flat ``1. … 2. …`` numbering across at least two
    distinct numbers. Without two numbers we can't distinguish a stray
    "1. Read each question carefully" instruction line from a real
    question opening.
    """
    seen_numbers: set[int] = set()
    for block in blocks:
        if block.kind != "p":
            continue
        if _is_instruction_paragraph(block):
            continue
        match = _NUMBERED_START_RE.match(block.text)
        if match:
            seen_numbers.add(int(match.group("num")))
            if len(seen_numbers) >= 2:
                return True
    return False


def _is_instruction_paragraph(block: _Block) -> bool:
    """Heuristic: 2022 instructions live in class ``ji`` paragraphs and
    appear before the first ``jn``-class question paragraph.
    """
    return block.css_class.strip() == "ji"


# ---------------------------------------------------------------------------
# Roman-numeral (legacy 2006-2021) parser
# ---------------------------------------------------------------------------


def _parse_roman_format(blocks: list[_Block]) -> list[ParsedBarQuestion]:
    """Walk blocks, opening a new question whenever a Roman-numeral marker
    paragraph appears. Collects everything until the next marker into the
    current question's body.
    """
    questions: list[ParsedBarQuestion] = []
    current_number: int | None = None
    current_body: list[str] = []
    current_blocks: list[_Block] = []
    seen_numbers: set[int] = set()

    def flush() -> None:
        nonlocal current_number, current_body, current_blocks
        if current_number is None:
            return
        body = " ".join(current_body).strip()
        if len(body) < _MIN_QUESTION_BODY_CHARS:
            current_number = None
            current_body = []
            current_blocks = []
            return
        sub_parts = _count_sub_parts(body, current_blocks)
        questions.append(
            ParsedBarQuestion(
                question_number=current_number,
                question_text=body,
                sub_parts_count=sub_parts,
            ),
        )
        current_number = None
        current_body = []
        current_blocks = []

    for block in blocks:
        marker = _detect_roman_marker(block)
        if marker is not None:
            flush()
            if marker in seen_numbers:
                # Duplicate marker (rare LawPhil quirk); skip to keep
                # ``question_number`` unique.
                logger.warning(
                    "Duplicate Roman-numeral marker %d on LawPhil page", marker,
                )
                continue
            seen_numbers.add(marker)
            current_number = marker
            continue
        if current_number is None:
            continue
        if _PART_MARKER_RE.match(block.text) or _END_MARKER_RE.search(block.text):
            continue
        current_body.append(block.text)
        current_blocks.append(block)

    flush()
    return questions


def _detect_roman_marker(block: _Block) -> int | None:
    """Return the integer value if ``block`` is a Roman-numeral question
    marker (centred paragraph containing only a Roman numeral, optionally
    flanked by dashes). Otherwise None.
    """
    if block.kind != "p":
        return None
    if "center" not in block.align.lower():
        return None
    match = _ROMAN_MARKER_RE.match(block.text)
    if not match:
        return None
    roman = match.group("roman").upper().strip()
    if not roman:
        return None
    # Skip the "I" of "INSTRUCTIONS"-like noise — markers stand alone in
    # their paragraph; a non-empty word other than the numeral disqualifies.
    if roman != block.text.strip().upper().strip("- –—.").strip():
        return None
    value = _roman_to_int(roman)
    if value is None or value <= 0:
        return None
    return value


def _roman_to_int(s: str) -> int | None:
    total = 0
    prev = 0
    for ch in reversed(s):
        v = _ROMAN_VALUES.get(ch)
        if v is None:
            return None
        if v < prev:
            total -= v
        else:
            total += v
            prev = v
    return total


# ---------------------------------------------------------------------------
# Ordered-list (2015) parser
# ---------------------------------------------------------------------------


def _find_ordered_lists(blocks: list[_Block]) -> list[_Block]:
    """Return the ``<ol type="I">`` blocks that carry the page's questions.

    Requires at least two *direct* ``<li>`` children: one is a fragment, and
    counting descendants instead would also count the sub-part lists nested
    inside an item.
    """
    found: list[_Block] = []
    for block in blocks:
        if block.kind != "ol":
            continue
        list_type = str(block.element.get("type", "")).strip().lower()
        if list_type != "i":
            continue
        if len(_direct_items(block.element)) >= 2:
            found.append(block)
    return found


def _direct_items(element: Tag) -> list[Tag]:
    """Direct ``<li>`` children of ``element`` (never nested ones)."""
    return [
        child
        for child in element.find_all("li", recursive=False)
        if isinstance(child, Tag)
    ]


def _parse_ordered_list_format(ol_blocks: list[_Block]) -> list[ParsedBarQuestion]:
    """One question per ``<li>``, numbered 1..N across the page in order.

    The ``<ol type="I">`` renders I, II, III… in the browser, but the
    numerals exist nowhere in the text, so the item's position IS its number.
    Multiple lists on one page continue the same sequence rather than
    restarting — a paper split across two ``<ol>`` blocks is still one paper.

    Each item's text is its own text plus every following non-``<li>``
    sibling up to the next ``<li>``: LawPhil's malformed markup sometimes
    leaves a sub-part ``<p>``/``<dir>`` as a sibling of the item it belongs
    to rather than a child of it.
    """
    questions: list[ParsedBarQuestion] = []
    number = 0
    for block in ol_blocks:
        for item in _direct_items(block.element):
            parts = [item.get_text(" ", strip=True)]
            parts.extend(
                sibling.get_text(" ", strip=True)
                for sibling in _trailing_siblings(item)
            )
            body = _normalize_whitespace(" ".join(p for p in parts if p))
            if len(body) < _MIN_QUESTION_BODY_CHARS:
                # A stray or empty <li> is not an item. Skipping it without
                # consuming a number keeps the sequence contiguous, which the
                # (sitting, question_number) unique key depends on.
                continue
            number += 1
            questions.append(
                ParsedBarQuestion(
                    question_number=number,
                    question_text=body,
                    sub_parts_count=_count_list_sub_parts(body, item),
                ),
            )
    return questions


def _trailing_siblings(item: Tag) -> list[Tag]:
    """Element siblings after ``item`` up to (not including) the next ``<li>``."""
    trailing: list[Tag] = []
    for sibling in item.next_siblings:
        if not isinstance(sibling, Tag):
            continue
        if sibling.name == "li":
            break
        trailing.append(sibling)
    return trailing


def _count_list_sub_parts(body: str, item: Tag) -> int:
    """Sub-part count for a list-format item.

    Separate from ``_count_sub_parts`` because this format marks sub-parts
    "a)" rather than "(a)", and reusing the shared counter would either miss
    them or loosen a pattern the other two formats rely on.
    """
    explicit = _EXPLICIT_SUBPART_RE.search(body)
    if explicit is not None:
        token = explicit.group("count").lower()
        if token.isdigit():
            return int(token)
        word_value = _WORD_TO_INT.get(token)
        if word_value is not None:
            return word_value

    letters = {m.group("letter").lower() for m in _LIST_SUBPART_RE.finditer(body)}
    letters |= {m.group(1).lower() for m in re.finditer(r"\(([a-z])\)", body)}
    nested = [
        len(_direct_items(lst))
        for lst in item.find_all(["ol", "ul"])
        if isinstance(lst, Tag)
    ]
    return max([len(letters), *nested]) if nested else len(letters)


# ---------------------------------------------------------------------------
# Numbered (2022) parser
# ---------------------------------------------------------------------------


def _instruction_region(blocks: list[_Block]) -> set[int]:
    """Return the indices of the blocks that make up the examiner's preamble.

    Structural, not lexical. Every LawPhil paper heads its preamble with a
    centred ``INSTRUCTIONS`` paragraph and then numbers the instructions
    ``1.``, ``2.``, … — the same shape the numbered *question* format uses,
    which is exactly why the numbered parser used to mistake one for the
    other. The region therefore runs from that heading through the
    strictly-increasing numbered run beneath it (unnumbered paragraphs in
    between are continuations of the instruction above them) and ends at the
    first block that cannot belong to it:

    * a non-paragraph block — the ``<ol>`` holding the questions (2015);
    * a numbered paragraph whose number does not continue the run, i.e. the
      numbering restarts — the question list beginning (2022: instructions
      1..10, then questions 1..15).

    Two deliberate refusals to guess:

    * if the heading is not immediately followed by a ``1.`` paragraph there
      is no numbered instruction run to delimit, so only the heading itself
      is claimed;
    * if the run reaches the end of the page without a terminator, the page
      has no distinguishable question list and claiming every paragraph as
      instructions would silently empty it — so again only the heading is
      claimed, and ``_looks_like_instructions`` stays the net.

    Pages with no ``INSTRUCTIONS`` heading yield an empty set and are handled
    entirely by ``_looks_like_instructions``.
    """
    start: int | None = None
    for index, block in enumerate(blocks):
        if block.kind == "p" and _INSTRUCTIONS_HEADER_RE.match(block.text):
            start = index
            break
    if start is None:
        return set()

    region = {start}
    highest = 0
    terminated = False
    for index in range(start + 1, len(blocks)):
        block = blocks[index]
        if block.kind != "p":
            terminated = True
            break
        match = _NUMBERED_START_RE.match(block.text)
        if match is not None:
            number = int(match.group("num"))
            if number <= highest:
                # Numbering restarted — this is the question list, not a
                # further instruction.
                terminated = True
                break
            highest = number
        elif highest == 0:
            # Heading not followed by a numbered instruction run; there is
            # nothing structural to delimit.
            return {start}
        region.add(index)

    if not terminated:
        logger.warning(
            "INSTRUCTIONS heading with no question list after it; "
            "claiming only the heading as instructions",
        )
        return {start}
    return region


def _looks_like_instructions(text: str) -> bool:
    """True when ``text`` opens like the examiner's instruction block.

    The class="ji" rule that used to be the only defence is a 2022-page
    convention; the 2015 instructions are plain ``<p align="justify">`` and
    sail straight past it. Five 2015 sittings on prod stored four such
    paragraphs as their entire question set ("1. This Questionnaire contains
    …"), so this check is on the *output* of the numbered parser, where no
    page-specific convention can route around it.

    Matching is on the opening of the body only. A question that mentions
    reading each question carefully halfway through its fact pattern is
    still a question.
    """
    stripped = _NUMBERED_PREFIX_RE.sub("", text.strip(), count=1).lstrip()
    lowered = stripped.lower()
    if not lowered:
        return True
    return any(lowered.startswith(opening) for opening in _INSTRUCTION_OPENINGS)


def _parse_numbered_format(blocks: list[_Block]) -> list[ParsedBarQuestion]:
    """Walk blocks, opening a new question whenever a paragraph starts with
    ``<digit>.`` and tracks an increasing sequence. Trailing instruction-
    style paragraphs (class "ji") and "NOTHING FOLLOWS" markers terminate
    accumulation.

    The examiner's preamble is excised structurally before the walk begins
    (``_instruction_region``), so its numbered paragraphs are never candidate
    questions on any page. ``_looks_like_instructions`` remains as a second
    net for pages that carry no ``INSTRUCTIONS`` heading to anchor to.
    """
    instruction_indices = _instruction_region(blocks)
    questions: list[ParsedBarQuestion] = []
    current_number: int | None = None
    current_body: list[str] = []
    current_blocks: list[_Block] = []
    seen_numbers: set[int] = set()
    expected_next = 1

    def flush() -> None:
        nonlocal current_number, current_body, current_blocks
        if current_number is None:
            return
        body = " ".join(current_body).strip()
        if len(body) < _MIN_QUESTION_BODY_CHARS or _looks_like_instructions(body):
            if current_number is not None and _looks_like_instructions(body):
                logger.warning(
                    "Dropped instruction paragraph mis-read as question %d: %s",
                    current_number,
                    body[:80],
                )
            current_number = None
            current_body = []
            current_blocks = []
            return
        sub_parts = _count_sub_parts(body, current_blocks)
        questions.append(
            ParsedBarQuestion(
                question_number=current_number,
                question_text=body,
                sub_parts_count=sub_parts,
            ),
        )
        current_number = None
        current_body = []
        current_blocks = []

    for index, block in enumerate(blocks):
        if index in instruction_indices:
            continue
        if block.kind != "p":
            continue
        # Skip 2022 instruction paragraphs entirely — they live in class "ji"
        # and would otherwise grab "1. This is a 4-hour examination …" as a
        # spurious question.
        if _is_instruction_paragraph(block) and current_number is None:
            continue
        if _PART_MARKER_RE.match(block.text):
            # PART A / PART B section break — flush current question, but
            # keep the running expected_next so numbering continues 1..N.
            flush()
            continue
        if _END_MARKER_RE.search(block.text):
            flush()
            continue

        match = _NUMBERED_START_RE.match(block.text)
        if match is not None:
            if current_number is None and _looks_like_instructions(block.text):
                continue
            num = int(match.group("num"))
            # Reject backwards or repeated numbers — a paragraph like
            # "1. This is a 4-hour examination" lurking outside a class="ji"
            # block should not reset the question stream.
            if num < expected_next or num in seen_numbers:
                if current_number is not None:
                    current_body.append(block.text)
                    current_blocks.append(block)
                continue
            flush()
            seen_numbers.add(num)
            current_number = num
            current_body = [block.text]
            current_blocks = [block]
            expected_next = num + 1
            continue

        if current_number is not None:
            current_body.append(block.text)
            current_blocks.append(block)

    flush()
    return questions


# ---------------------------------------------------------------------------
# Sub-part counting (shared)
# ---------------------------------------------------------------------------


def _count_sub_parts(body: str, blocks: list[_Block]) -> int:
    """Count distinct ``(a)``/``(b)``/``(c)``/… markers in the body OR
    ``<li>`` items in nested lists, taking the maximum.

    Both styles appear in LawPhil archives:

    - Legacy ``<ol>`` lists for 2006-style numbered sub-parts (no inline
      ``(a)`` text — the markers are rendered by the browser).
    - 2022 inline ``(a)``/``(b)`` markers without an enclosing list.

    Explicit override: if the body contains a ``[This item has N questions.]``
    declaration (case-insensitive, with ``N`` as a digit or a number word
    one..ten), trust the declaration and return ``N`` immediately. This
    prevents inline ``(i)/(ii)/(iii)`` enumeration *inside* the fact pattern
    (e.g. 2022 Civil Law Q6's three lease terms) from inflating the count
    above the genuine sub-question total declared by the examiner.
    """
    # Authoritative marker wins over the heuristic. We only honour the first
    # match — multiple declarations in a single question body are not a
    # pattern we have observed in the LawPhil corpus.
    explicit = _EXPLICIT_SUBPART_RE.search(body)
    if explicit is not None:
        token = explicit.group("count").lower()
        if token.isdigit():
            return int(token)
        word_value = _WORD_TO_INT.get(token)
        if word_value is not None:
            return word_value
        # Marker present but the count token is unrecognised — fall through
        # to the heuristic rather than returning 0.

    # Inline letter markers — collect distinct lowercase letters.
    letters = {m.group(1).lower() for m in re.finditer(r"\(([a-z])\)", body)}
    letter_count = len(letters)

    # <li> items in any nested <ol> or <ul> inside the question's blocks.
    li_count = 0
    for block in blocks:
        if block.kind in ("ol", "ul"):
            items = [c for c in block.element.find_all("li") if isinstance(c, Tag)]
            li_count = max(li_count, len(items))
        else:
            for child_list in block.element.find_all(["ol", "ul"]):
                items = [c for c in child_list.find_all("li") if isinstance(c, Tag)]
                li_count = max(li_count, len(items))

    return max(letter_count, li_count)


__all__ = ["ParsedBarPage", "ParsedBarQuestion", "parse", "parse_page"]
