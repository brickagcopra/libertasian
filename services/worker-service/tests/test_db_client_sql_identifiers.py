"""Regression guard for raw-SQL table/column identifiers in
``src/clients/db_client.py``.

The April 2026 incident: db_client.py used PascalCase quoted identifiers
(e.g. ``"UserUpload"``, ``"ocrStatus"``) that don't exist in PostgreSQL —
Prisma ``@@map``/``@map`` snake-cases everything. Every raw-SQL call
raised ``UndefinedTable`` / ``UndefinedColumn``, but downstream tasks
swallowed the failure as "non-blocking" and 1421 documents shipped to
prod without embeddings, doctrines, or citations.

These tests pin the SQL strings so the regression cannot happen again.
Each test mocks ``psycopg2.connect`` and inspects what the function would
send to the database — no real connection is opened.
"""

from __future__ import annotations

import re
from typing import Any
from unittest.mock import MagicMock, patch

import psycopg2.errors
import pytest

# Tables and columns that must NEVER appear in any raw-SQL string emitted
# by db_client.py — these are the PascalCase identifiers the original bug
# used. Tests assert their absence in every executed SQL.
FORBIDDEN_IDENTIFIERS = (
    '"UserUpload"',
    '"OcrResult"',
    '"CameraCapture"',
    '"UploadProcessingJob"',
    '"LegalDocumentSection"',
    '"DoctrineExtract"',
    '"Citation"',
    '"ModelRun"',
    '"ocrStatus"',
    '"processingStatus"',
    '"updatedAt"',
    '"createdAt"',
    '"objectKey"',
    '"userUploadId"',
    '"pageNumber"',
    '"qualityScore"',
    '"ocrConfidence"',
    '"languageDetected"',
    '"extractedTextObjectKey"',
    '"wordCount"',
    '"captureQualityScore"',
    '"errorMessage"',
    '"jobType"',
    '"legalDocumentId"',
    '"sectionType"',
    '"sectionLabel"',
    '"plainText"',
    '"pageStart"',
    '"pageEnd"',
    '"normalizedText"',
    '"doctrineType"',
    '"sourceSectionId"',
    '"reviewStatus"',
    '"citationText"',
    '"normalizedCitation"',
    '"citationType"',
    '"fromDocumentId"',
    '"toDocumentId"',
    '"resolvedAt"',
    '"resolverMethod"',
    '"runType"',
    '"modelName"',
    '"modelVersion"',
    '"promptTemplateVersion"',
    '"inputRef"',
    '"outputRef"',
    '"tokensIn"',
    '"tokensOut"',
    '"latencyMs"',
)


def _executed_sql(mock_cursor: MagicMock) -> list[str]:
    """Collect the SQL strings passed to ``cursor.execute``."""
    statements: list[str] = []
    for call in mock_cursor.execute.call_args_list:
        # call.args[0] is the SQL — first positional argument.
        statements.append(call.args[0])
    return statements


def _assert_no_forbidden_identifiers(statements: list[str]) -> None:
    joined = "\n".join(statements)
    for forbidden in FORBIDDEN_IDENTIFIERS:
        assert forbidden not in joined, (
            f"Forbidden PascalCase identifier {forbidden!r} found in raw "
            f"SQL — this caused the April 2026 silent-degradation incident.\n"
            f"Offending SQL:\n{joined}"
        )


def _assert_targets_table(statements: list[str], table: str) -> None:
    """Assert at least one statement targets ``table`` in the expected
    snake-case form (FROM/UPDATE/INTO).
    """
    pattern = re.compile(
        rf"\b(FROM|UPDATE|INTO|JOIN)\s+{re.escape(table)}\b",
        re.IGNORECASE,
    )
    joined = "\n".join(statements)
    assert pattern.search(joined), (
        f"Expected at least one raw SQL statement to reference table "
        f"{table!r}, got:\n{joined}"
    )


@pytest.fixture()
def mock_psycopg2_connect() -> Any:
    """Patch ``psycopg2.connect`` so db_client functions execute against a
    mock cursor.
    """
    with patch("src.clients.db_client.psycopg2.connect") as mock_connect:
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        # ``with conn.cursor(...) as cur`` returns the cursor.
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.cursor.return_value.__exit__.return_value = False
        # ``fetchone`` / ``fetchall`` return empty by default.
        mock_cursor.fetchone.return_value = None
        mock_cursor.fetchall.return_value = []
        mock_connect.return_value = mock_conn
        yield mock_cursor


# ─── Per-function SQL identifier assertions ─────────────────────────────


def test_update_upload_ocr_status_uses_snake_case(
    mock_psycopg2_connect: MagicMock,
) -> None:
    from src.clients.db_client import update_upload_ocr_status

    update_upload_ocr_status("upload-1", "complete")
    statements = _executed_sql(mock_psycopg2_connect)
    _assert_no_forbidden_identifiers(statements)
    _assert_targets_table(statements, "user_uploads")
    assert any("ocr_status" in s for s in statements)


def test_update_upload_processing_status_uses_snake_case(
    mock_psycopg2_connect: MagicMock,
) -> None:
    from src.clients.db_client import update_upload_processing_status

    update_upload_processing_status("upload-1", "complete")
    statements = _executed_sql(mock_psycopg2_connect)
    _assert_no_forbidden_identifiers(statements)
    _assert_targets_table(statements, "user_uploads")
    assert any("processing_status" in s for s in statements)


def test_update_upload_classification_uses_snake_case(
    mock_psycopg2_connect: MagicMock,
) -> None:
    from src.clients.db_client import update_upload_classification

    update_upload_classification(
        upload_id="upload-1",
        document_type="case",
        citations_json={"citations": []},
    )
    statements = _executed_sql(mock_psycopg2_connect)
    _assert_no_forbidden_identifiers(statements)
    _assert_targets_table(statements, "user_uploads")
    assert any("classified_document_type" in s for s in statements)
    assert any("extracted_citations_json" in s for s in statements)
    assert any("ocr_text_object_key" in s for s in statements)


def test_create_ocr_result_uses_snake_case(
    mock_psycopg2_connect: MagicMock,
) -> None:
    from src.clients.db_client import create_ocr_result

    create_ocr_result(
        upload_id="upload-1",
        page_number=1,
        quality_score=0.9,
        ocr_confidence=0.95,
        language_detected="en",
        extracted_text_object_key="key/1",
        word_count=120,
    )
    statements = _executed_sql(mock_psycopg2_connect)
    _assert_no_forbidden_identifiers(statements)
    _assert_targets_table(statements, "ocr_results")
    for col in (
        "user_upload_id",
        "page_number",
        "quality_score",
        "ocr_confidence",
        "language_detected",
        "extracted_text_object_key",
        "word_count",
    ):
        assert any(col in s for s in statements), col


def test_update_camera_capture_quality_uses_snake_case(
    mock_psycopg2_connect: MagicMock,
) -> None:
    from src.clients.db_client import update_camera_capture_quality

    update_camera_capture_quality("upload-1", 0.8)
    statements = _executed_sql(mock_psycopg2_connect)
    _assert_no_forbidden_identifiers(statements)
    _assert_targets_table(statements, "camera_captures")
    assert any("capture_quality_score" in s for s in statements)
    assert any("user_upload_id" in s for s in statements)


def test_update_processing_job_uses_snake_case(
    mock_psycopg2_connect: MagicMock,
) -> None:
    from src.clients.db_client import update_processing_job

    update_processing_job(
        upload_id="upload-1",
        job_type="ocr",
        status="failed",
        error_message="boom",
        metadata={"k": "v"},
    )
    statements = _executed_sql(mock_psycopg2_connect)
    _assert_no_forbidden_identifiers(statements)
    _assert_targets_table(statements, "upload_processing_jobs")
    for col in ("user_upload_id", "job_type", "error_message", "updated_at"):
        assert any(col in s for s in statements), col


def test_get_upload_object_key_uses_snake_case(
    mock_psycopg2_connect: MagicMock,
) -> None:
    from src.clients.db_client import get_upload_object_key

    get_upload_object_key("upload-1")
    statements = _executed_sql(mock_psycopg2_connect)
    _assert_no_forbidden_identifiers(statements)
    _assert_targets_table(statements, "user_uploads")
    assert any("object_key" in s for s in statements)


def test_get_document_sections_uses_snake_case(
    mock_psycopg2_connect: MagicMock,
) -> None:
    from src.clients.db_client import get_document_sections

    # RealDictCursor is requested via cursor_factory; rebind it on the mock.
    # We don't assert on row shape here, just on SQL.
    get_document_sections("doc-1")
    statements = _executed_sql(mock_psycopg2_connect)
    _assert_no_forbidden_identifiers(statements)
    _assert_targets_table(statements, "legal_document_sections")
    for col in (
        "section_type",
        "section_label",
        "plain_text",
        "page_start",
        "page_end",
        "legal_document_id",
    ):
        assert any(col in s for s in statements), col


def test_create_doctrine_extract_uses_snake_case(
    mock_psycopg2_connect: MagicMock,
) -> None:
    from src.clients.db_client import create_doctrine_extract

    create_doctrine_extract(
        legal_document_id="doc-1",
        text="A doctrine.",
        normalized_text=None,
        doctrine_type="principle",
        source_section_id=None,
        confidence=0.9,
        review_status="ai_generated",
    )
    statements = _executed_sql(mock_psycopg2_connect)
    _assert_no_forbidden_identifiers(statements)
    _assert_targets_table(statements, "doctrine_extracts")
    for col in (
        "legal_document_id",
        "normalized_text",
        "doctrine_type",
        "source_section_id",
        "review_status",
        "updated_at",
    ):
        assert any(col in s for s in statements), col


def test_get_unresolved_citations_uses_snake_case(
    mock_psycopg2_connect: MagicMock,
) -> None:
    from src.clients.db_client import get_unresolved_citations

    get_unresolved_citations("doc-1")
    statements = _executed_sql(mock_psycopg2_connect)
    _assert_no_forbidden_identifiers(statements)
    _assert_targets_table(statements, "citations")
    for col in (
        "citation_text",
        "normalized_citation",
        "citation_type",
        "from_document_id",
        "to_document_id",
        "created_at",
    ):
        assert any(col in s for s in statements), col


def test_update_citation_resolution_uses_snake_case(
    mock_psycopg2_connect: MagicMock,
) -> None:
    from src.clients.db_client import update_citation_resolution

    update_citation_resolution(
        citation_id="cit-1",
        to_document_id="doc-2",
        confidence=0.9,
        resolver_method="auto",
    )
    statements = _executed_sql(mock_psycopg2_connect)
    _assert_no_forbidden_identifiers(statements)
    _assert_targets_table(statements, "citations")
    for col in ("to_document_id", "resolved_at", "resolver_method"):
        assert any(col in s for s in statements), col


def test_create_model_run_uses_snake_case(
    mock_psycopg2_connect: MagicMock,
) -> None:
    from src.clients.db_client import create_model_run

    create_model_run(
        run_type="doctrine_extract",
        model_name="m",
        prompt_template_version="v1",
        input_ref="ref",
        output_ref="ref",
        confidence=None,
    )
    statements = _executed_sql(mock_psycopg2_connect)
    _assert_no_forbidden_identifiers(statements)
    _assert_targets_table(statements, "model_runs")
    for col in (
        "run_type",
        "model_name",
        "model_version",
        "prompt_template_version",
        "input_ref",
        "output_ref",
        "tokens_in",
        "tokens_out",
        "latency_ms",
    ):
        assert any(col in s for s in statements), col


def test_get_existing_embedding_ids_uses_snake_case(
    mock_psycopg2_connect: MagicMock,
) -> None:
    from src.clients.db_client import get_existing_embedding_ids

    get_existing_embedding_ids("section", ["s1", "s2"])
    statements = _executed_sql(mock_psycopg2_connect)
    _assert_no_forbidden_identifiers(statements)
    _assert_targets_table(statements, "embeddings")
    for col in ("entity_id", "entity_type"):
        assert any(col in s for s in statements), col


def test_get_existing_embedding_ids_casts_array_to_uuid(
    mock_psycopg2_connect: MagicMock,
) -> None:
    """``embeddings.entity_id`` is ``uuid``; psycopg2 binds a Python
    ``list[str]`` as ``text[]``. Without ``::uuid[]`` PG raises
    ``operator does not exist: uuid = text`` and embedding generation
    fails on every document — exactly what halted the post-PR-#78
    reprocess in prod.
    """
    from src.clients.db_client import get_existing_embedding_ids

    get_existing_embedding_ids(
        "section",
        [
            "11111111-1111-1111-1111-111111111111",
            "22222222-2222-2222-2222-222222222222",
        ],
    )
    statements = _executed_sql(mock_psycopg2_connect)
    joined = "\n".join(statements)
    assert "ANY(%s::uuid[])" in joined, (
        "get_existing_embedding_ids must cast its array param to uuid[] — "
        "naked ANY(%s) raises operator-does-not-exist against the uuid "
        f"column in PostgreSQL. SQL was:\n{joined}"
    )
    # Defensive: make sure no naked ``ANY(%s)`` slipped back in alongside
    # the cast variant. Allow ``ANY(%s::<type>[])`` only.
    assert "ANY(%s)" not in joined.replace("ANY(%s::uuid[])", ""), (
        f"Found naked ANY(%s) without a type cast. SQL was:\n{joined}"
    )


def test_create_embedding_uses_snake_case(
    mock_psycopg2_connect: MagicMock,
) -> None:
    from src.clients.db_client import create_embedding

    create_embedding(
        entity_type="section",
        entity_id="s1",
        embedding_model="bge",
        vector_ref="[]",
    )
    statements = _executed_sql(mock_psycopg2_connect)
    _assert_no_forbidden_identifiers(statements)
    _assert_targets_table(statements, "embeddings")
    for col in ("entity_type", "entity_id", "embedding_model", "vector_ref"):
        assert any(col in s for s in statements), col


def test_create_embeddings_batch_uses_snake_case(
    mock_psycopg2_connect: MagicMock,
) -> None:
    from src.clients.db_client import create_embeddings_batch

    create_embeddings_batch([
        {
            "entity_type": "section",
            "entity_id": "s1",
            "embedding_model": "bge",
            "vector_ref": "[]",
        },
    ])
    statements = _executed_sql(mock_psycopg2_connect)
    _assert_no_forbidden_identifiers(statements)
    _assert_targets_table(statements, "embeddings")


# ─── SchemaIntegrityError contract ───────────────────────────────────────


def test_undefined_table_raises_schema_integrity_error() -> None:
    """``UndefinedTable`` raised by psycopg2 must surface as
    :class:`SchemaIntegrityError`. This is what forces tasks to send the
    failure to DLQ instead of swallowing it as "non-blocking".
    """
    from src.clients.db_client import SchemaIntegrityError, get_connection

    with patch("src.clients.db_client.psycopg2.connect") as mock_connect:
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.execute.side_effect = psycopg2.errors.UndefinedTable(
            'relation "X" does not exist',
        )
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.cursor.return_value.__exit__.return_value = False
        mock_connect.return_value = mock_conn

        with (
            pytest.raises(SchemaIntegrityError),
            get_connection() as conn,
            conn.cursor() as cur,
        ):
            cur.execute("SELECT 1 FROM doesnotexist")


def test_undefined_column_raises_schema_integrity_error() -> None:
    from src.clients.db_client import SchemaIntegrityError, get_connection

    with patch("src.clients.db_client.psycopg2.connect") as mock_connect:
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.execute.side_effect = psycopg2.errors.UndefinedColumn(
            'column "doesnotexist" does not exist',
        )
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.cursor.return_value.__exit__.return_value = False
        mock_connect.return_value = mock_conn

        with (
            pytest.raises(SchemaIntegrityError),
            get_connection() as conn,
            conn.cursor() as cur,
        ):
            cur.execute("SELECT doesnotexist FROM legal_documents")


def test_other_exceptions_pass_through_unchanged() -> None:
    """Non-schema errors (e.g. transient OperationalError) must not be
    wrapped — only ``UndefinedTable`` / ``UndefinedColumn`` are bugs.
    """
    import psycopg2

    from src.clients.db_client import SchemaIntegrityError, get_connection

    with patch("src.clients.db_client.psycopg2.connect") as mock_connect:
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.execute.side_effect = psycopg2.OperationalError("boom")
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.cursor.return_value.__exit__.return_value = False
        mock_connect.return_value = mock_conn

        with (
            pytest.raises(psycopg2.OperationalError),
            get_connection() as conn,
            conn.cursor() as cur,
        ):
            cur.execute("SELECT 1")

        # And it must not have been wrapped.
        try:
            with get_connection() as conn, conn.cursor() as cur:
                cur.execute("SELECT 1")
        except SchemaIntegrityError:
            pytest.fail("OperationalError must not become SchemaIntegrityError")
        except psycopg2.OperationalError:
            pass
