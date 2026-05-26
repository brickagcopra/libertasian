"""LIBERTASIAN Worker Service — One-shot foundational codal seed.

Imports a hard-coded list of foundational Philippine codals from Lawphil
into ``legal_documents`` + ``legal_document_sections`` +
``legal_document_versions`` + ``legal_document_tag_map``.

This unblocks the ``/study/codals`` reader page on prod, which is empty
because no codals have been imported yet. The discover-mode crawler in
``LawphilFetcher`` targets jurisprudence (judjuris), not codals (statutes
/ executive / constitutions / rules), so codals need a separate import
path.

Phase 1 — 8 codals (the CPRA / A.M. 22-09-01-SC is not published as a
single HTML page on Lawphil and is left as a TODO). Phase 2 (full
PD/EO/Proclamation crawl) is a separate task.

**Manual trigger only** — NOT scheduled on the Celery beat. Fire from a
worker shell:

    docker compose -f docker-compose.prod.yml exec worker-service \\
        uv run python -m src.tasks.seed_codals_task --dry-run

    docker compose -f docker-compose.prod.yml exec worker-service \\
        uv run python -m src.tasks.seed_codals_task --commit

Idempotent: a codal whose ``(citation_text, document_type)`` already
exists in ``legal_documents`` is skipped.

URL verification rule: every URL in ``SEED_CODALS`` was checked with
``curl -sI -L`` against ``lawphil.net`` (not www., per the expired-cert
quirk described in ``fetchers/lawphil.py``) before being added here.
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import re
import sys
import uuid as uuid_mod
from dataclasses import dataclass, field
from typing import Any

from bs4 import BeautifulSoup, Tag
from celery import shared_task

from ..clients.db_client import get_connection
from ..clients.s3_client import upload_file
from ..config import settings
from ..fetchers.lawphil import LawphilFetcher

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Seed list
# ---------------------------------------------------------------------------
#
# Subject codes match ``apps/api/prisma/seed-bar-subjects.ts`` exactly —
# in particular ``commercial_law`` (not ``mercantile_law``) and
# ``taxation_law`` (not ``taxation``). The seed file is the source of
# truth for ``legal_metadata_tags.code`` so any mismatch here would
# silently drop the tag-map row in ``_upsert_tag_map``.
#
# URLs were all verified with ``curl -sI -L`` on 2026-05-21. Notes on
# corrections from the original task spec:
#
#   * Family Code (EO 209): ``execorders/`` (per task spec) → ``execord/``
#     (actual lawphil path). The ``execorders`` directory does not exist.
#   * Revised Penal Code (Act 3815): ``acts/act_3815_1930.html`` (per
#     task spec) → ``acts/act1930/act_3815_1930.html`` (actual nested
#     directory layout used for pre-1935 acts).
#   * CPRA (A.M. 22-09-01-SC): omitted. Lawphil does not host the CPRA
#     itself as a single HTML page — only individual SC resolutions
#     about it. Tracked as TODO; Phase 2 will source it elsewhere.
@dataclass
class CodalSeed:
    title: str
    short_title: str
    url: str
    document_type: str
    citation_text: str
    primary_subject: str
    secondary_subjects: list[str] = field(default_factory=list)


SEED_CODALS: list[CodalSeed] = [
    CodalSeed(
        title="1987 Constitution of the Philippines",
        short_title="1987 Constitution",
        url="https://lawphil.net/consti/cons1987.html",
        document_type="constitution",
        citation_text="Const. (1987)",
        primary_subject="political_law",
        secondary_subjects=[
            "civil_law",
            "criminal_law",
            "labor_law",
            "commercial_law",
            "remedial_law",
            "taxation_law",
            "legal_ethics",
        ],
    ),
    CodalSeed(
        title="An Act to Ordain and Institute the Civil Code of the Philippines",
        short_title="Civil Code (RA 386)",
        url="https://lawphil.net/statutes/repacts/ra1949/ra_386_1949.html",
        document_type="codal",
        citation_text="Rep. Act No. 386",
        primary_subject="civil_law",
    ),
    CodalSeed(
        title="The Family Code of the Philippines",
        short_title="Family Code (EO 209)",
        url="https://lawphil.net/executive/execord/eo1987/eo_209_1987.html",
        document_type="codal",
        citation_text="Exec. Order No. 209 (1987)",
        primary_subject="civil_law",
    ),
    CodalSeed(
        title="The Revised Penal Code",
        short_title="Revised Penal Code (Act 3815)",
        url="https://lawphil.net/statutes/acts/act1930/act_3815_1930.html",
        document_type="codal",
        citation_text="Act No. 3815",
        primary_subject="criminal_law",
    ),
    CodalSeed(
        title="A Decree Instituting a Labor Code",
        short_title="Labor Code (PD 442)",
        url="https://lawphil.net/statutes/presdecs/pd1974/pd_442_1974.html",
        document_type="codal",
        citation_text="Pres. Decree No. 442",
        primary_subject="labor_law",
    ),
    CodalSeed(
        title="The National Internal Revenue Code of 1997",
        short_title="NIRC (RA 8424)",
        url="https://lawphil.net/statutes/repacts/ra1997/ra_8424_1997.html",
        document_type="codal",
        citation_text="Rep. Act No. 8424",
        primary_subject="taxation_law",
    ),
    CodalSeed(
        title="Revised Corporation Code of the Philippines",
        short_title="RCC (RA 11232)",
        url="https://lawphil.net/statutes/repacts/ra2019/ra_11232_2019.html",
        document_type="republic_act",
        citation_text="Rep. Act No. 11232",
        primary_subject="commercial_law",
    ),
    CodalSeed(
        title="Rules of Court of the Philippines",
        short_title="Rules of Court",
        url="https://lawphil.net/courts/rules/rc.html",
        document_type="rules_of_court",
        citation_text="Rules of Court",
        primary_subject="remedial_law",
    ),
    # ------------------------------------------------------------------
    # Executive issuances (2026-05-25). URLs verified 200 via curl -sI -L
    # against lawphil.net before commit. The Admin Code and Omnibus
    # Investments Code are EO 292 / EO 226 — the same ``execord/eo1987/``
    # directory the Family Code lives in (NOT ``execorders/``, which
    # does not exist on lawphil). The four PDs sit under
    # ``statutes/presdecs/pd<year>/`` per Lawphil's nested layout.
    CodalSeed(
        title="Administrative Code of 1987",
        short_title="Admin Code (EO 292)",
        url="https://lawphil.net/executive/execord/eo1987/eo_292_1987.html",
        document_type="executive_order",
        citation_text="Exec. Order No. 292 (1987)",
        primary_subject="political_law",
    ),
    CodalSeed(
        title="Omnibus Investments Code of 1987",
        short_title="Omnibus Investments Code (EO 226)",
        url="https://lawphil.net/executive/execord/eo1987/eo_226_1987.html",
        document_type="executive_order",
        citation_text="Exec. Order No. 226 (1987)",
        primary_subject="commercial_law",
    ),
    CodalSeed(
        title="Property Registration Decree",
        short_title="PD 1529",
        url="https://lawphil.net/statutes/presdecs/pd1978/pd_1529_1978.html",
        document_type="presidential_decree",
        citation_text="Pres. Decree No. 1529",
        primary_subject="civil_law",
    ),
    CodalSeed(
        title="Subdivision and Condominium Buyers' Protective Decree",
        short_title="PD 957",
        url="https://lawphil.net/statutes/presdecs/pd1976/pd_957_1976.html",
        document_type="presidential_decree",
        citation_text="Pres. Decree No. 957",
        primary_subject="civil_law",
    ),
    CodalSeed(
        title="Code of Muslim Personal Laws",
        short_title="PD 1083",
        url="https://lawphil.net/statutes/presdecs/pd1977/pd_1083_1977.html",
        document_type="presidential_decree",
        citation_text="Pres. Decree No. 1083",
        primary_subject="civil_law",
    ),
    CodalSeed(
        title="Probation Law of 1976",
        short_title="PD 968",
        url="https://lawphil.net/statutes/presdecs/pd1976/pd_968_1976.html",
        document_type="presidential_decree",
        citation_text="Pres. Decree No. 968",
        primary_subject="criminal_law",
    ),
]


# ---------------------------------------------------------------------------
# Section parsing
# ---------------------------------------------------------------------------

# Matches the structural marker at the START of a heading or bold-text
# line — ARTICLE 1, Section 3, RULE 14, TITLE I, CHAPTER II, etc. The
# trailing label-number is required so generic uses of "Article" inside
# running prose don't accidentally split sections.
_SECTION_MARKER_RE = re.compile(
    r"^\s*(ARTICLE|Article|TITLE|Title|CHAPTER|Chapter|"
    r"SECTION|Section|RULE|Rule|BOOK|Book)\s+([\dIVXLC]+)",
)

# END-anchored variant for the text-line fallback. The whole line must
# be ONLY a marker + numeral (with optional trailing punctuation), so
# running-prose cross-references like "Section 16 of this Code." do NOT
# match and are not treated as section boundaries. Pages like Lawphil's
# EO 292 carry their markers in plain <p>/<br> text (no heading or bold
# tag), so the tag-driven pass in ``_parse_sections`` misses them — this
# regex is the boundary detector for the fallback pass below.
_TEXT_SECTION_MARKER_RE = re.compile(
    r"^\s*(ARTICLE|Article|TITLE|Title|CHAPTER|Chapter|"
    r"SECTION|Section|RULE|Rule|BOOK|Book)\s+([\dIVXLC]+)\s*[.:)]?\s*$",
)

_SECTION_TYPE_BY_KEYWORD: dict[str, str] = {
    "article": "article",
    "title": "title",
    "chapter": "chapter",
    "section": "section",
    "rule": "rule",
    "book": "book",
}


def _is_heading_tag(tag: Tag) -> bool:
    return tag.name in {"h1", "h2", "h3", "h4", "h5", "h6"}


def _is_bold_marker_tag(tag: Tag) -> bool:
    return tag.name in {"b", "strong"}


def _classify_marker(label: str) -> str:
    """Return ``section_type`` for a marker label (e.g. ``ARTICLE 1``)."""
    match = _SECTION_MARKER_RE.match(label)
    if not match:
        return "section"
    return _SECTION_TYPE_BY_KEYWORD.get(match.group(1).lower(), "section")


@dataclass
class ParsedSection:
    section_type: str
    section_label: str
    plain_text: str


def _parse_sections(html: str) -> list[ParsedSection]:
    """Extract structural sections from a lawphil codal HTML page.

    Strategy (Phase 1 — keep it boring):

    1. Walk the document body. Whenever we see a heading tag or a bold /
       strong tag whose text starts with one of the recognised markers
       (ARTICLE / TITLE / CHAPTER / SECTION / RULE / BOOK), open a new
       section.
    2. Accumulate plain text from every following node until the next
       marker — that's the section body.
    3. If we never see a marker, return a single fallback section with
       the full plain text (acceptable Phase-1 outcome per task spec).
    """
    soup = BeautifulSoup(html, "lxml")
    body = soup.body or soup

    sections: list[ParsedSection] = []
    current_label: str | None = None
    current_type: str = "section"
    current_buffer: list[str] = []

    def flush() -> None:
        if current_label is None:
            return
        text = " ".join(s for s in current_buffer if s).strip()
        sections.append(
            ParsedSection(
                section_type=current_type,
                section_label=current_label,
                plain_text=text,
            ),
        )

    for element in body.descendants:
        if not isinstance(element, Tag):
            continue
        # Skip tags that contain other tags we'll visit separately, except
        # when the tag IS a heading / bold marker — those we want.
        text = element.get_text(" ", strip=True)
        if not text:
            continue

        is_marker = (
            (_is_heading_tag(element) or _is_bold_marker_tag(element))
            and _SECTION_MARKER_RE.match(text) is not None
        )
        if is_marker:
            # Boundary — close the previous section, open a new one.
            flush()
            current_label = text[:255]
            current_type = _classify_marker(text)
            current_buffer = []
            continue

        # Only accumulate text from leaf-ish content tags (paragraphs and
        # cells). The full descendant walk would otherwise double-count
        # text contained in nested tags.
        if element.name in {"p", "td", "li"}:
            current_buffer.append(text)

    flush()

    if not sections:
        # Pages like Lawphil's EO 292 carry markers (BOOK I, CHAPTER 1,
        # Section 1.) in plain <p>/<br> text — not in heading or bold
        # tags — so the descendant walk above never opens a section.
        # Try a text-line pass before collapsing to a single "Full Text"
        # blob, and only accept it if it actually found structure
        # (>= 2 sections). Otherwise fall through to the single-section
        # fallback so genuinely unstructured pages still import.
        text_sections = _parse_sections_by_text(html)
        if len(text_sections) >= 2:
            logger.info(
                "No tag markers; text-line pass found %d sections.",
                len(text_sections),
            )
            return text_sections
        full_text = body.get_text("\n", strip=True)
        logger.warning(
            "No structural markers found — single-section import (length=%d).",
            len(full_text),
        )
        sections.append(
            ParsedSection(
                section_type="section",
                section_label="Full Text",
                plain_text=full_text,
            ),
        )

    return sections


def _parse_sections_by_text(html: str) -> list[ParsedSection]:
    """Fallback segmentation for pages whose markers are NOT in heading
    or bold tags (e.g. Lawphil's EO 292, which places BOOK I, CHAPTER 1,
    Section 1. inside plain <p> text). Splits the body's plain text on
    lines that are exactly a structural marker
    (BOOK/TITLE/CHAPTER/SECTION/RULE/ARTICLE + numeral)."""
    soup = BeautifulSoup(html, "lxml")
    body = soup.body or soup

    sections: list[ParsedSection] = []
    current_label: str | None = None
    current_type: str = "section"
    buffer: list[str] = []

    def flush() -> None:
        if current_label is None:
            return
        text = "\n".join(b for b in buffer if b).strip()
        sections.append(
            ParsedSection(
                section_type=current_type,
                section_label=current_label,
                plain_text=text,
            ),
        )

    for raw_line in body.get_text("\n", strip=True).split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        if _TEXT_SECTION_MARKER_RE.match(line):
            flush()
            current_label = line[:255]
            current_type = _classify_marker(line)
            buffer = []
            continue
        buffer.append(line)
    flush()
    return sections


# ---------------------------------------------------------------------------
# Database operations
# ---------------------------------------------------------------------------


def _fetch_lawphil_source_id(conn: Any) -> str | None:
    """Look up the Lawphil source UUID by name. Returns None if missing."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM sources WHERE name = %s AND domain = %s LIMIT 1",
            ("Lawphil", "lawphil.net"),
        )
        row = cur.fetchone()
        return str(row[0]) if row else None


def _fetch_subject_tag_ids(conn: Any, codes: list[str]) -> dict[str, str]:
    """Look up tag UUIDs by ``legal_metadata_tags.code``."""
    if not codes:
        return {}
    with conn.cursor() as cur:
        cur.execute(
            "SELECT code, id FROM legal_metadata_tags WHERE code = ANY(%s)",
            (codes,),
        )
        return {str(code): str(tag_id) for code, tag_id in cur.fetchall()}


def _document_exists(conn: Any, citation: str, document_type: str) -> bool:
    """Idempotency check: has this codal already been imported?"""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT 1 FROM legal_documents
               WHERE citation_text = %s AND document_type = %s
               LIMIT 1""",
            (citation, document_type),
        )
        return cur.fetchone() is not None


def _insert_legal_document(
    conn: Any,
    *,
    document_id: str,
    source_id: str | None,
    codal: CodalSeed,
    checksum: str,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO legal_documents
                   (id, source_id, canonical_url, document_type, jurisdiction,
                    title, short_title, citation_text, status, language,
                    checksum, version_no, is_official, is_published,
                    truthfulness_status, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, 'PH',
                           %s, %s, %s, 'published', 'en',
                           %s, 1, true, true,
                           'verified', NOW(), NOW())""",
            (
                document_id,
                source_id,
                codal.url,
                codal.document_type,
                codal.title,
                codal.short_title,
                codal.citation_text,
                checksum,
            ),
        )


def _insert_sections(
    conn: Any,
    *,
    document_id: str,
    sections: list[ParsedSection],
) -> None:
    rows = [
        (
            str(uuid_mod.uuid4()),
            document_id,
            sec.section_type,
            sec.section_label,
            ordering,
            sec.plain_text,
        )
        for ordering, sec in enumerate(sections, start=1)
    ]
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO legal_document_sections
                   (id, legal_document_id, section_type, section_label,
                    ordering, plain_text, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, NOW())""",
            rows,
        )


def _insert_version(
    conn: Any,
    *,
    document_id: str,
    raw_object_key: str | None,
    normalized_object_key: str | None,
    snapshot_hash: str,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO legal_document_versions
                   (id, legal_document_id, raw_file_object_key,
                    normalized_text_object_key, html_object_key,
                    snapshot_hash, parser_version, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())""",
            (
                str(uuid_mod.uuid4()),
                document_id,
                raw_object_key,
                normalized_object_key,
                raw_object_key,
                snapshot_hash,
                "codal_seed_v1",
            ),
        )


def _insert_tag_maps(
    conn: Any,
    *,
    document_id: str,
    primary_tag_id: str,
    secondary_tag_ids: list[str],
) -> None:
    rows: list[tuple[Any, ...]] = [
        (
            str(uuid_mod.uuid4()),
            document_id,
            primary_tag_id,
            True,
            "seed",
            "auto",
        ),
    ]
    rows.extend(
        (
            str(uuid_mod.uuid4()),
            document_id,
            tag_id,
            False,
            "seed",
            "auto",
        )
        for tag_id in secondary_tag_ids
    )
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO legal_document_tag_map
                   (id, legal_document_id, tag_id, is_primary,
                    classified_by, review_status)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
            rows,
        )


# ---------------------------------------------------------------------------
# S3
# ---------------------------------------------------------------------------


def _upload_raw_html(document_id: str, html_bytes: bytes) -> str | None:
    """Upload raw HTML to the corpus bucket. Returns the object key or
    None if S3 isn't configured (dev environments without MinIO)."""
    if not settings.s3_access_key:
        logger.info("S3 not configured (no access key) — skipping raw HTML upload")
        return None
    key = f"codals/{document_id}/raw.html"
    upload_file(
        key,
        html_bytes,
        content_type="text/html; charset=windows-1252",
        bucket=settings.s3_bucket_corpus,
    )
    return key


def _upload_normalized_text(document_id: str, text: str) -> str | None:
    if not settings.s3_access_key:
        return None
    key = f"codals/{document_id}/normalized.txt"
    upload_file(
        key,
        text.encode("utf-8"),
        content_type="text/plain; charset=utf-8",
        bucket=settings.s3_bucket_corpus,
    )
    return key


# ---------------------------------------------------------------------------
# Per-codal pipeline
# ---------------------------------------------------------------------------


@dataclass
class CodalOutcome:
    status: str  # "skipped" | "inserted" | "failed"
    reason: str | None = None
    section_count: int = 0


def _process_codal(
    fetcher: LawphilFetcher,
    codal: CodalSeed,
    *,
    dry_run: bool,
) -> CodalOutcome:
    with get_connection() as conn:
        if _document_exists(conn, codal.citation_text, codal.document_type):
            return CodalOutcome(status="skipped", reason="already imported")
        source_id = _fetch_lawphil_source_id(conn)
        if not source_id:
            return CodalOutcome(
                status="failed",
                reason="Lawphil source row missing — run seed-sources first",
            )
        all_codes = [codal.primary_subject, *codal.secondary_subjects]
        tag_ids = _fetch_subject_tag_ids(conn, all_codes)
        if codal.primary_subject not in tag_ids:
            return CodalOutcome(
                status="failed",
                reason=(
                    f"primary subject tag '{codal.primary_subject}' missing — "
                    "run seed-bar-subjects first"
                ),
            )
        primary_tag_id = tag_ids[codal.primary_subject]
        secondary_tag_ids = [
            tag_ids[code]
            for code in codal.secondary_subjects
            if code in tag_ids
        ]
        missing_secondaries = [
            code for code in codal.secondary_subjects if code not in tag_ids
        ]
        if missing_secondaries:
            logger.warning(
                "%s: missing secondary subject tags %s — they will be skipped",
                codal.short_title, missing_secondaries,
            )

    # Fetch outside the DB transaction so a slow network doesn't hold a
    # write connection open. Network IO is the slowest part of the loop.
    try:
        fetched = fetcher.fetch_content(codal.url)
    except Exception as exc:  # noqa: BLE001
        return CodalOutcome(status="failed", reason=f"fetch error: {exc}")

    html = fetched.html
    if not html.strip():
        return CodalOutcome(status="failed", reason="empty HTML response")

    sections = _parse_sections(html)
    normalized_text = "\n\n".join(
        f"{s.section_label}\n{s.plain_text}" for s in sections if s.plain_text
    )
    checksum = hashlib.sha256(html.encode("windows-1252", errors="replace")).hexdigest()

    if dry_run:
        logger.info(
            "DRY-RUN would insert %s | sections=%d | citation=%r",
            codal.short_title, len(sections), codal.citation_text,
        )
        return CodalOutcome(
            status="inserted",
            reason="dry-run",
            section_count=len(sections),
        )

    document_id = str(uuid_mod.uuid4())

    # S3 uploads happen BEFORE the DB write so we never have a
    # legal_document row pointing at an object key that doesn't exist.
    raw_key = _upload_raw_html(
        document_id,
        html.encode("windows-1252", errors="replace"),
    )
    normalized_key = _upload_normalized_text(document_id, normalized_text)

    with get_connection() as conn:
        _insert_legal_document(
            conn,
            document_id=document_id,
            source_id=source_id,
            codal=codal,
            checksum=checksum,
        )
        _insert_sections(
            conn,
            document_id=document_id,
            sections=sections,
        )
        _insert_version(
            conn,
            document_id=document_id,
            raw_object_key=raw_key,
            normalized_object_key=normalized_key,
            snapshot_hash=checksum,
        )
        _insert_tag_maps(
            conn,
            document_id=document_id,
            primary_tag_id=primary_tag_id,
            secondary_tag_ids=secondary_tag_ids,
        )
    return CodalOutcome(
        status="inserted",
        reason=None,
        section_count=len(sections),
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def _parse_document_types_arg(value: str | None) -> set[str] | None:
    """Parse a comma-separated ``--document-types`` value into a set.

    Returns ``None`` when unset/blank so callers can treat that as
    "no filter" (process every entry). Empty tokens are dropped.
    """
    if value is None:
        return None
    tokens = {t.strip() for t in value.split(",") if t.strip()}
    return tokens or None


def _filter_codals_by_document_types(
    codals: list[CodalSeed],
    document_types: set[str] | None,
) -> list[CodalSeed]:
    """Keep only entries whose ``document_type`` is in ``document_types``.

    ``None`` means "no filter" — return the list unchanged. Order is
    preserved so the processing log matches the source-list order.
    """
    if document_types is None:
        return codals
    return [c for c in codals if c.document_type in document_types]


def run_seed(
    *,
    dry_run: bool,
    limit: int | None = None,
    codals: list[CodalSeed] | None = None,
) -> dict[str, int]:
    """Iterate ``SEED_CODALS`` and import each. Returns counters.

    ``--batch`` is accepted on the CLI for parity with
    ``backfill_ponente_task`` but is a no-op here: the seed list is
    bounded and small enough to run in a single pass.

    When ``codals`` is provided, it overrides ``SEED_CODALS`` — used by
    the CLI to apply the ``--document-types`` filter without mutating
    module-level state. Defaults to the full seed list.
    """
    counters = {"processed": 0, "inserted": 0, "skipped": 0, "failed": 0}
    fetcher = LawphilFetcher()

    seed_list = codals if codals is not None else SEED_CODALS

    for codal in seed_list:
        if limit is not None and counters["processed"] >= limit:
            break
        counters["processed"] += 1
        try:
            outcome = _process_codal(fetcher, codal, dry_run=dry_run)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Unexpected error processing %s", codal.short_title)
            counters["failed"] += 1
            logger.info(
                "%s: FAILED — unexpected error: %s",
                codal.short_title, exc,
            )
            continue

        counters[outcome.status] += 1
        logger.info(
            "%s: %s%s%s",
            codal.short_title,
            outcome.status.upper(),
            f" ({outcome.reason})" if outcome.reason else "",
            f" sections={outcome.section_count}"
            if outcome.section_count
            else "",
        )

    return counters


@shared_task(name="seed.codals")
def seed_codals_task(
    dry_run: bool = True,
    limit: int | None = None,
) -> dict[str, int]:
    """Celery task wrapper. Manual dispatch only — not on beat schedule."""
    return run_seed(dry_run=dry_run, limit=limit)


def _cli() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--commit", action="store_true", default=False)
    parser.add_argument("--batch", type=int, default=None, help="no-op (kept for CLI parity)")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--document-types",
        type=str,
        default=None,
        help=(
            "Comma-separated document_type allow-list (e.g. "
            "'executive_order,presidential_decree'). Default: process all."
        ),
    )
    args = parser.parse_args()

    dry_run = True
    if args.commit:
        dry_run = False

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    document_types = _parse_document_types_arg(args.document_types)
    codals = _filter_codals_by_document_types(SEED_CODALS, document_types)
    if document_types is not None:
        logger.info(
            "Filtering to document_types=%s — %d/%d entries selected",
            sorted(document_types), len(codals), len(SEED_CODALS),
        )

    counters = run_seed(dry_run=dry_run, limit=args.limit, codals=codals)
    print("counters:", counters)
    if dry_run:
        print("Dry run only — re-run with --commit to apply.")
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
