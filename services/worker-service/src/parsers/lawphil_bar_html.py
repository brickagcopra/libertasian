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

Both formats are decoded under windows-1252 (LawPhil's native encoding).
The caller is responsible for handing us already-decoded text.
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


@dataclass(frozen=True)
class ParsedBarQuestion:
    """One numbered question parsed from a LawPhil bar exam page."""

    question_number: int
    question_text: str
    sub_parts_count: int = 0
    source_section_anchor: str | None = None


def parse(html: str) -> list[ParsedBarQuestion]:
    """Parse a LawPhil bar exam page into a list of structured questions.

    Returns an empty list if the page does not match either known format
    (e.g. answer-key page mistakenly fed in, or LawPhil HTML drift).
    """
    if not html or not html.strip():
        return []

    soup = BeautifulSoup(html, "lxml")
    blocks = _collect_content_blocks(soup)
    if not blocks:
        return []

    # Prefer Roman-numeral parsing whenever the page actually has them —
    # 2018-era papers carry instruction paragraphs that begin with a
    # numeric "1." prefix outside any class system, which would otherwise
    # cause the format detector to mis-classify them as numbered (2022)
    # format.
    if _has_roman_markers(blocks):
        return _parse_roman_format(blocks)
    if _is_numbered_format(blocks):
        return _parse_numbered_format(blocks)
    return []


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
# Numbered (2022) parser
# ---------------------------------------------------------------------------


def _parse_numbered_format(blocks: list[_Block]) -> list[ParsedBarQuestion]:
    """Walk blocks, opening a new question whenever a paragraph starts with
    ``<digit>.`` and tracks an increasing sequence. Trailing instruction-
    style paragraphs (class "ji") and "NOTHING FOLLOWS" markers terminate
    accumulation.
    """
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
    """
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


__all__ = ["ParsedBarQuestion", "parse"]
