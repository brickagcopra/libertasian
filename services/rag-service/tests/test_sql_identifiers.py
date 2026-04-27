"""Regression guard for raw-SQL table/column identifiers in
``services/rag-service/src/``.

Mirrors ``services/worker-service/tests/test_db_client_sql_identifiers.py``
introduced by PR #78. The April 2026 incident chain:

  1. PR #78 found PascalCase quoted identifiers in worker-service raw SQL
     (e.g. ``"UserUpload"``, ``"ocrStatus"``) — none of them exist in
     PostgreSQL because Prisma ``@@map`` / ``@map`` snake-cases everything.
  2. The audit during that PR flagged the same class of bug in
     services/rag-service/src/citations/* (``"LegalDocument"``,
     ``"SourceSection"``, ``"fullText"``, etc.) but deferred the fix.
  3. PR #82 (this PR) closes that gap. These tests pin the rag-service
     SQL strings so the regression cannot reappear.

Strategy: walk every Python source file under ``services/rag-service/src``,
extract any string literal that looks like raw SQL (heuristic: contains
``SELECT ``, ``UPDATE ``, ``INSERT ``, ``DELETE FROM ``), and assert that
no FORBIDDEN identifier appears in the literal. We complement that with
existence checks for the snake_case targets we expect.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Source under test
# ---------------------------------------------------------------------------

SRC_ROOT = Path(__file__).resolve().parent.parent / "src"
SQL_LITERAL_HINTS = ("SELECT ", "UPDATE ", "INSERT INTO ", "DELETE FROM ")


# ---------------------------------------------------------------------------
# Forbidden identifiers — every PascalCase or camelCase quoted identifier
# the prior code was using that does NOT exist in the snake_case schema.
# ---------------------------------------------------------------------------

FORBIDDEN_TABLE_IDENTIFIERS: tuple[str, ...] = (
    '"LegalDocument"',
    '"LegalDocumentSection"',
    '"LegalDocumentVersion"',
    # SourceSection never existed — the code was conflating it with
    # legal_document_sections. List it so anyone copy-pasting a stale
    # query can't reintroduce it.
    '"SourceSection"',
    '"SourceEndpoint"',
    '"DigestArtifact"',
    '"Digest"',
    '"Citation"',
    '"DoctrineExtract"',
    '"ModelRun"',
    '"BackfillBatch"',
)


FORBIDDEN_COLUMN_IDENTIFIERS: tuple[str, ...] = (
    '"shortTitle"',
    '"citationText"',
    '"fullText"',  # phantom — column never existed
    '"textContent"',  # phantom — sections use plain_text
    '"legalDocumentId"',
    '"pageStart"',
    '"pageEnd"',
    '"orderIndex"',  # phantom — sections use ordering
    '"grNo"',
    '"documentType"',
    '"sectionType"',
    '"sectionLabel"',
    '"plainText"',
    '"isOfficial"',
    '"isPublished"',
    '"sourceAuthorityLevel"',  # phantom — column never existed
    '"createdAt"',
    '"updatedAt"',
)


# Bare-keyword forbidden identifiers — phantom columns that should never
# appear at all (quoted or not). Catches code that removes the quoting
# but keeps the wrong name.
FORBIDDEN_BARE_PHANTOM_COLUMNS: tuple[str, ...] = (
    "source_authority_level",  # never existed on legal_documents
    "section_number",  # never existed on legal_document_sections
)


FORBIDDEN_IDENTIFIERS: tuple[str, ...] = (
    FORBIDDEN_TABLE_IDENTIFIERS
    + FORBIDDEN_COLUMN_IDENTIFIERS
)


# Snake_case targets we expect to see in at least one SQL literal somewhere
# in rag-service. Pinning these defends against accidental table renames.
EXPECTED_TABLE_TARGETS: tuple[str, ...] = (
    "legal_documents",
    "legal_document_sections",
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _iter_string_literals(path: Path) -> list[tuple[int, str]]:
    """Return (lineno, value) for every ``ast.Constant(str)`` in ``path``."""
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(path))
    out: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            out.append((node.lineno, node.value))
    return out


def _looks_like_sql(value: str) -> bool:
    """Heuristic: does this string literal look like raw SQL?"""
    upper = value.upper()
    return any(hint in upper for hint in SQL_LITERAL_HINTS)


def _all_sql_literals() -> list[tuple[Path, int, str]]:
    """Walk SRC_ROOT and return every SQL-looking string literal."""
    out: list[tuple[Path, int, str]] = []
    for path in SRC_ROOT.rglob("*.py"):
        # Skip the regression-test source itself in case it gets bundled
        # under SRC_ROOT in the future. Today it lives in tests/, but
        # being defensive keeps the walk safe.
        if "tests" in path.parts:
            continue
        for lineno, value in _iter_string_literals(path):
            if _looks_like_sql(value):
                out.append((path, lineno, value))
    return out


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_sql_root_exists() -> None:
    """Sanity: SRC_ROOT must point at a real directory or the walk is a no-op."""
    assert SRC_ROOT.is_dir(), f"Expected rag-service src at {SRC_ROOT}"


def test_at_least_one_sql_literal_was_collected() -> None:
    """If the walk returns zero literals, the regression guard is silently
    a no-op. The doctrine + database modules guarantee at least two."""
    literals = _all_sql_literals()
    assert len(literals) >= 2, (
        "Expected at least two SQL-looking literals across rag-service "
        f"sources, found {len(literals)}. The walk regressed; fix the "
        "heuristic in ``_looks_like_sql`` or expand SRC_ROOT."
    )


@pytest.mark.parametrize("forbidden", FORBIDDEN_IDENTIFIERS)
def test_no_forbidden_pascalcase_identifiers(forbidden: str) -> None:
    """No raw-SQL string anywhere in rag-service may contain a PascalCase
    table or column identifier left over from the pre-``@@map`` era."""
    offenders: list[str] = []
    for path, lineno, value in _all_sql_literals():
        if forbidden in value:
            offenders.append(f"{path.relative_to(SRC_ROOT)}:{lineno}")

    assert not offenders, (
        f"Forbidden PascalCase identifier {forbidden!r} found in raw SQL "
        f"in rag-service — this is the same class of bug PR #78 fixed in "
        f"the worker. Replace with the snake_case ``@@map`` target.\n"
        f"Offending sites:\n  " + "\n  ".join(offenders)
    )


@pytest.mark.parametrize("phantom", FORBIDDEN_BARE_PHANTOM_COLUMNS)
def test_no_phantom_columns(phantom: str) -> None:
    """Phantom columns (those the prior code referenced but which never
    existed in the Prisma schema) must not appear in any SQL literal."""
    pattern = re.compile(rf"\b{re.escape(phantom)}\b")
    offenders: list[str] = []
    for path, lineno, value in _all_sql_literals():
        if pattern.search(value):
            offenders.append(f"{path.relative_to(SRC_ROOT)}:{lineno}")

    assert not offenders, (
        f"Phantom column {phantom!r} found in raw SQL in rag-service. "
        f"This column does not exist in the Prisma schema — referencing "
        f"it raises UndefinedColumn, which the previous catch-all "
        f"swallowed.\nOffending sites:\n  " + "\n  ".join(offenders)
    )


@pytest.mark.parametrize("expected", EXPECTED_TABLE_TARGETS)
def test_expected_snake_case_tables_present(expected: str) -> None:
    """Each canonical snake_case table must appear at least once across
    rag-service raw SQL — proves the snake_case migration actually
    landed and didn't get reverted by a careless merge."""
    pattern = re.compile(rf"\b{re.escape(expected)}\b")
    found = any(pattern.search(value) for _, _, value in _all_sql_literals())
    assert found, (
        f"Expected snake_case table {expected!r} not found in any raw "
        f"SQL literal across rag-service. If the table was renamed, "
        f"update EXPECTED_TABLE_TARGETS; otherwise the migration was "
        f"reverted."
    )
