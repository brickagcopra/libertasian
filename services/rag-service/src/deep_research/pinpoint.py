"""Pinpoint lookup: fetch the exact article or section a question names.

A question such as "Civil Code of the Philippines, Article 1318" names its
authority precisely, and BM25 over the keyword index is a poor way to find it:
"1318" is one token among thousands of articles, and the Civil Code is a single
document of 2,533 sections competing with every decision that quotes it. So
when a sub-query (or the question itself) names "Article|Art.|Section|Sec. N"
together with a code or rule, the section is read straight from PostgreSQL —
the system of record — and added to the candidate pool before the rerank.

Everything here is read-only and parameterized: user text only ever reaches
SQL as a bound parameter (``$1``..``$n``), never through string formatting,
and the article / rule numbers that reach a LIKE pattern are regex-validated
digits with an optional ``-A`` suffix, so they carry no LIKE wildcards.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from ..core.retrieval import STATUTORY_DOCUMENT_TYPES
from ..core.schemas import Passage
from ..shared.database import acquire_connection
from ..shared.exceptions import SchemaIntegrityError

logger = logging.getLogger(__name__)

# At most this many distinct references are looked up per run; each costs a
# handful of indexed queries and contributes at most two passages.
MAX_PINPOINT_REFS = 4
_PASSAGE_TEXT_LIMIT = 2000
# Candidate documents tried per reference. The first whose sections actually
# contain the article wins, so an amending act whose title also says
# "Revised Penal Code" is skipped rather than trusted.
_MAX_CANDIDATE_DOCUMENTS = 5

Unit = Literal["article", "section"]


@dataclass(frozen=True)
class StatuteCode:
    key: str
    # Case-insensitive regex naming the code in free text.
    alias: str
    # ILIKE patterns matched against legal_documents.title / short_title.
    title_patterns: tuple[str, ...]
    document_types: tuple[str, ...]


_STATUTORY = tuple(sorted(STATUTORY_DOCUMENT_TYPES))

CODES: dict[str, StatuteCode] = {
    code.key: code
    for code in (
        StatuteCode(
            "civil_code",
            r"(?:new\s+)?civil\s+code(?:\s+of\s+the\s+philippines)?|\bNCC\b",
            ("%Civil Code%",),
            _STATUTORY,
        ),
        StatuteCode(
            "revised_penal_code",
            r"revised\s+penal\s+code|\bRPC\b",
            ("%Revised Penal Code%",),
            _STATUTORY,
        ),
        StatuteCode("family_code", r"family\s+code", ("%Family Code%",), _STATUTORY),
        StatuteCode("labor_code", r"labou?r\s+code", ("%Labor Code%",), _STATUTORY),
        StatuteCode(
            "local_government_code",
            r"local\s+government\s+code|\bLGC\b",
            ("%Local Government Code%",),
            _STATUTORY,
        ),
        StatuteCode(
            "tax_code",
            r"national\s+internal\s+revenue\s+code|\bNIRC\b|\btax\s+code",
            ("%National Internal Revenue Code%", "%Tax Code%"),
            _STATUTORY,
        ),
        StatuteCode(
            "corporation_code",
            r"(?:revised\s+)?corporation\s+code",
            ("%Corporation Code%",),
            _STATUTORY,
        ),
        StatuteCode(
            "rules_of_court",
            r"rules\s+of\s+court|\bROC\b",
            ("%Rules of Court%",),
            ("rules_of_court",),
        ),
    )
}

_CODE_RES: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (code.key, re.compile(code.alias, re.IGNORECASE)) for code in CODES.values()
)

# A statutory number: digits, optionally "-A" (Art. 266-A, Rule 139-A).
_NUM = r"\d{1,4}(?:-[A-Za-z])?"
_ARTICLE_RE = re.compile(rf"\b(?:Article|Art\.?)\s*({_NUM})(?![\w-])", re.IGNORECASE)
_RULE_THEN_SECTION_RE = re.compile(
    rf"\bRule\s+({_NUM})\s*,?\s*(?:Section|Sec\.?)\s*(\d{{1,3}})(?![\w-])", re.IGNORECASE
)
_SECTION_THEN_RULE_RE = re.compile(
    rf"\b(?:Section|Sec\.?)\s*(\d{{1,3}})\s*(?:,|of)?\s*(?:the\s+)?Rule\s+({_NUM})(?![\w-])",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class PinpointRef:
    """One precisely-named provision: ``Article 1318`` of the Civil Code, or
    ``Section 5`` of ``Rule 113`` of the Rules of Court."""

    code: str
    unit: Unit
    number: str
    rule: str | None = None

    def label_patterns(self) -> list[str]:
        """ILIKE patterns for ``legal_document_sections.section_label``.

        The trailing ``.`` is what stops "Article 13" matching "Article 130.".
        """
        if self.unit == "article":
            return [f"Article {self.number}.%", f"Art. {self.number}.%"]
        return [f"Section {self.number}.%", f"Sec. {self.number}.%"]


def _norm(number: str) -> str:
    return number.upper()


def _nearest_code(text: str, start: int, end: int) -> str | None:
    """The code whose mention in ``text`` is closest to the span ``start:end``."""
    best: tuple[int, str] | None = None
    for key, pattern in _CODE_RES:
        for match in pattern.finditer(text):
            if match.end() <= start:
                distance = start - match.end()
            elif match.start() >= end:
                distance = match.start() - end
            else:
                distance = 0
            if best is None or distance < best[0]:
                best = (distance, key)
    return best[1] if best else None


def parse_pinpoints(text: str) -> list[PinpointRef]:
    """Every precisely-named provision in ``text`` (rule sections first).

    * "Article|Art. N" is kept only when a known code is named in the same
      text; it is attributed to the nearest such mention.
    * "Rule N Section M" (either order) always means the Rules of Court.
    """
    refs: list[PinpointRef] = []
    rule_spans: list[tuple[int, int]] = []

    for match in _RULE_THEN_SECTION_RE.finditer(text):
        refs.append(PinpointRef("rules_of_court", "section", match.group(2), _norm(match.group(1))))
        rule_spans.append(match.span())
    for match in _SECTION_THEN_RULE_RE.finditer(text):
        if any(start <= match.start() < end for start, end in rule_spans):
            continue
        refs.append(PinpointRef("rules_of_court", "section", match.group(1), _norm(match.group(2))))

    for match in _ARTICLE_RE.finditer(text):
        code = _nearest_code(text, match.start(), match.end())
        if code is None or code == "rules_of_court":
            continue
        refs.append(PinpointRef(code, "article", _norm(match.group(1))))

    return list(dict.fromkeys(refs))


def collect_pinpoints(texts: Sequence[str], limit: int = MAX_PINPOINT_REFS) -> list[PinpointRef]:
    """Distinct references across ``texts`` (question first), at most ``limit``."""
    seen: dict[PinpointRef, None] = {}
    for text in texts:
        for ref in parse_pinpoints(text):
            seen.setdefault(ref, None)
            if len(seen) >= limit:
                return list(seen)
    return list(seen)


# ---------------------------------------------------------------------------
# SQL — parameterized only. snake_case identifiers per the @@map'd schema
# (see tests/test_sql_identifiers.py).
# ---------------------------------------------------------------------------

_DOCUMENT_SQL = (
    "SELECT d.id::text AS id, d.title, d.citation_text, d.document_type, "
    "d.is_official, src.trust_level "
    "FROM legal_documents d LEFT JOIN sources src ON src.id = d.source_id "
    "WHERE d.document_type = ANY($1::text[]) "
    "AND (d.title ILIKE ANY($2::text[]) OR d.short_title ILIKE ANY($2::text[])) "
    "ORDER BY d.is_official DESC, d.is_published DESC, d.created_at DESC "
    "LIMIT $3"
)

# First section of the rule heading ("RULE 113"), used as the lower bound when
# the Rules of Court are stored as one document with every rule inside it.
_RULE_ANCHOR_SQL = (
    "SELECT min(s.ordering) FROM legal_document_sections s "
    "WHERE s.legal_document_id = $1::uuid AND s.section_label ~* $2"
)

# The named section (first match after the anchor) plus the section after it.
_SECTION_SQL = (
    "WITH target AS ("
    "SELECT s.ordering FROM legal_document_sections s "
    "WHERE s.legal_document_id = $1::uuid AND s.ordering > $2 "
    "AND s.section_label ILIKE ANY($3::text[]) "
    "ORDER BY s.ordering LIMIT 1) "
    "SELECT s.id::text AS id, s.section_label, s.plain_text "
    "FROM legal_document_sections s JOIN target t ON s.ordering >= t.ordering "
    "WHERE s.legal_document_id = $1::uuid "
    "ORDER BY s.ordering LIMIT 2"
)


def _rule_regex(rule: str) -> str:
    """POSIX regex (bound as a parameter) for a "RULE 113" heading label.

    The trailing class stops Rule 139 matching "RULE 139-A" or "RULE 1390".
    """
    return rf"^\s*rule\s+{re.escape(rule)}([^0-9a-z-]|$)"


def _authority(row: Any) -> str:
    trust = row["trust_level"]
    if trust:
        return str(trust)
    return "official" if row["is_official"] else "editorial"


async def _fetch_ref(conn: Any, ref: PinpointRef) -> list[Passage]:
    code = CODES[ref.code]
    documents = await conn.fetch(
        _DOCUMENT_SQL,
        list(code.document_types),
        list(code.title_patterns),
        _MAX_CANDIDATE_DOCUMENTS,
    )
    for document in documents:
        document_id = str(document["id"])
        anchor = -1
        if ref.rule is not None:
            rule_re = _rule_regex(ref.rule)
            found = await conn.fetchval(_RULE_ANCHOR_SQL, document_id, rule_re)
            if found is not None:
                anchor = int(found)
            elif not re.search(rule_re.lstrip("^"), str(document["title"] or ""), re.IGNORECASE):
                # Neither a rule heading inside it nor a per-rule document.
                continue

        rows = await conn.fetch(_SECTION_SQL, document_id, anchor, ref.label_patterns())
        passages = [
            Passage(
                id=f"pinpoint:{row['id']}",
                document_id=document_id,
                section_id=str(row["id"]),
                title=str(document["title"] or ""),
                citation_text=str(document["citation_text"] or ""),
                text=str(row["plain_text"] or "")[:_PASSAGE_TEXT_LIMIT],
                document_type=str(document["document_type"] or ""),
                source_authority_level=_authority(document),
            )
            for row in rows
            if (row["plain_text"] or "").strip()
        ]
        if passages:
            return passages
    return []


async def fetch_pinpoint_passages(texts: Sequence[str]) -> list[Passage]:
    """Passages for every provision the texts name precisely. Best effort.

    Returns ``[]`` without touching the database when nothing is named. A
    lookup failure degrades to ``[]`` — ordinary retrieval still ran — except
    a `SchemaIntegrityError`, which is a code bug and is re-raised.
    """
    refs = collect_pinpoints(texts)
    if not refs:
        return []
    passages: list[Passage] = []
    try:
        async with acquire_connection() as conn:
            for ref in refs:
                passages.extend(await _fetch_ref(conn, ref))
    except SchemaIntegrityError:
        logger.exception("SchemaIntegrityError in deep research pinpoint lookup")
        raise
    except Exception as exc:  # noqa: BLE001 - enrichment is best effort
        logger.warning("Deep research pinpoint lookup failed: %s", type(exc).__name__)
        return []
    logger.info(
        "Deep research pinpoint: %d reference(s) -> %d passage(s)", len(refs), len(passages)
    )
    return passages
