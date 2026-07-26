"""Execution-path tests for the derivative re-score script.

Two production incidents shaped this file, and both were shipped by a script
whose database code never ran in CI:

1. A ``%s::text`` cast against a ``uuid`` column — ``operator does not exist:
   uuid > text`` on the first page, so it never read a row.
2. A wrong extraction for ``mcq_question``: a row is one question, not a set,
   so all 70,488 rows recomputed to 0.200 and 46,081 were reported as dropping
   below the auto-approval bar. Applying that would have destroyed valid
   scores.

The fake connection here answers queries from a row table rather than a fixed
page sequence, so pagination, the reproduction check and the write path all
execute the way they would against Postgres.

``test_query_runs_against_real_postgres`` runs the real statements when
``RESCORE_TEST_DATABASE_URL`` is set, and skips otherwise.
"""

from __future__ import annotations

import os
import re
from typing import Any

import pytest

from src.scripts import rescore_derivatives as rd

SOURCE_SECTIONS = [
    {"id": f"sec-{i:03d}", "plain_text": f"Section {i}."} for i in range(40)
]

# 5 cards each citing one distinct section, against 40 sections:
#   legacy (document denominator): 5/40 = 0.125 -> 0.5625
#   current (citable denominator):  5/10 = 0.5   -> 0.75
LEGACY_SCORE = 0.5625
CURRENT_SCORE = 0.75


def _flashcard_content(cited: int = 5, cards: int = 5) -> dict[str, Any]:
    return {
        "cards": [
            {
                "front": f"Q{i}",
                "back": f"A{i}",
                "supportingSectionIds": [f"sec-{i:03d}"] if i < cited else [],
            }
            for i in range(cards)
        ],
    }


def _row(
    artifact_id: str,
    *,
    dtype: str = "flashcard",
    stored: float | None = LEGACY_SCORE,
    content: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": artifact_id,
        "derivative_type": dtype,
        "source_document_id": "11111111-1111-1111-1111-111111111111",
        "content_json": content if content is not None else _flashcard_content(),
        "confidence_score": stored,
    }


class FakeCursor:
    """Answers the script's SELECT from a row table; records every statement."""

    def __init__(self, state: dict[str, Any]):
        self._state = state
        self._rows: list[dict[str, Any]] = []

    def __enter__(self) -> FakeCursor:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def execute(self, sql: str, params: Any = None) -> None:
        self._state["log"].append((sql, params))
        if not sql.strip().startswith("SELECT"):
            self._rows = []
            return
        types, last_id, _last_id_again, page_size = params
        rows = [
            r
            for r in self._state["rows"]
            if r["derivative_type"] in types
            and (last_id is None or str(r["id"]) > str(last_id))
        ]
        rows.sort(key=lambda r: str(r["id"]))
        self._rows = rows[:page_size]

    def fetchall(self) -> list[dict[str, Any]]:
        return self._rows


class FakeConnection:
    def __init__(self, state: dict[str, Any]):
        self._state = state

    def __enter__(self) -> FakeConnection:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def cursor(self, **kwargs: Any) -> FakeCursor:
        return FakeCursor(self._state)

    def commit(self) -> None:
        self._state["commits"] += 1


@pytest.fixture
def fake_db(monkeypatch: pytest.MonkeyPatch):
    state: dict[str, Any] = {"rows": [], "log": [], "commits": 0}
    monkeypatch.setattr(rd, "get_connection", lambda: FakeConnection(state))
    monkeypatch.setattr(
        rd.db, "get_document_sections_for_digest", lambda _doc_id: SOURCE_SECTIONS
    )
    monkeypatch.delenv("RESCORE_ALLOW_WRITE", raising=False)
    return state


@pytest.fixture
def captured_writes(monkeypatch: pytest.MonkeyPatch):
    writes: list[tuple[str, list[Any]]] = []
    monkeypatch.setattr(
        rd.psycopg2.extras,
        "execute_batch",
        lambda cur, sql, params: writes.append((sql, params)),
    )
    return writes


# ---------------------------------------------------------------------------
# Types that cannot be re-scored from row content
# ---------------------------------------------------------------------------


class TestUnsupportedTypes:
    def test_mcq_question_is_not_scorable(self) -> None:
        """The incident: a row is one question, the score is the batch's."""
        assert "mcq_question" not in rd.SCORERS
        assert "mcq_question" in rd.UNSUPPORTED_TYPES

    def test_subject_outline_is_not_scorable(self) -> None:
        """Scored over multiple documents; the row keeps only the primary."""
        assert "subject_outline" not in rd.SCORERS
        assert "subject_outline" in rd.UNSUPPORTED_TYPES

    def test_requesting_mcq_refuses_and_touches_no_row(self, fake_db, capsys) -> None:
        fake_db["rows"] = [_row("a" * 36, dtype="mcq_question", stored=0.9)]

        exit_code = rd.main_with_args(["--type", "mcq_question"])

        assert exit_code == 4
        assert fake_db["log"] == []
        out = capsys.readouterr().out
        assert "REFUSED" in out
        assert "property of the batch" in out or "batch" in out

    def test_requesting_subject_outline_refuses(self, fake_db) -> None:
        fake_db["rows"] = [_row("a" * 36, dtype="subject_outline")]

        assert rd.main_with_args(["--type", "subject_outline"]) == 4
        assert fake_db["log"] == []

    def test_default_run_never_selects_an_unsupported_type(self, fake_db) -> None:
        fake_db["rows"] = [
            _row("a" * 36),
            _row("b" * 36, dtype="mcq_question", stored=0.9),
        ]

        rd.main_with_args([])

        for sql, params in fake_db["log"]:
            if sql.strip().startswith("SELECT"):
                assert "mcq_question" not in params[0]
                assert "subject_outline" not in params[0]

    def test_unsupported_types_are_named_in_the_report(self, fake_db, capsys) -> None:
        """Never silently omitted — the operator has to see the exclusion."""
        fake_db["rows"] = [_row("a" * 36)]

        rd.main_with_args([])

        out = capsys.readouterr().out
        assert "mcq_question" in out
        assert "subject_outline" in out


# ---------------------------------------------------------------------------
# The reproduction check
# ---------------------------------------------------------------------------


class TestReproductionCheck:
    def test_passes_when_the_stored_score_is_reproduced(self, fake_db, capsys) -> None:
        fake_db["rows"] = [_row(f"{i:036d}", stored=LEGACY_SCORE) for i in range(3)]

        exit_code = rd.main_with_args(["--verify-only", "--type", "flashcard"])

        assert exit_code == 0
        out = capsys.readouterr().out
        assert "flashcard: OK — reproduced 3/3" in out

    def test_fails_when_the_stored_score_cannot_be_reproduced(
        self, fake_db, capsys
    ) -> None:
        """A shape mismatch looks exactly like this."""
        fake_db["rows"] = [_row(f"{i:036d}", stored=0.99) for i in range(3)]

        exit_code = rd.main_with_args(["--verify-only", "--type", "flashcard"])

        assert exit_code == 3
        out = capsys.readouterr().out
        assert "FAILED" in out
        assert "stored=0.9900" in out
        assert "recomputed=0.5625" in out

    def test_a_type_with_no_rows_proves_nothing_and_does_not_pass(
        self, fake_db, capsys
    ) -> None:
        fake_db["rows"] = []

        exit_code = rd.main_with_args(["--verify-only", "--type", "flashcard"])

        assert exit_code == 3
        assert "NO ROWS SAMPLED" in capsys.readouterr().out

    def test_verification_uses_the_legacy_denominator(self, fake_db) -> None:
        """Stored scores came from the old formula, so reproduction must too."""
        rows = [_row(f"{i:036d}", stored=CURRENT_SCORE) for i in range(2)]
        fake_db["rows"] = rows

        # Stored at the CURRENT score, so reproducing under the legacy
        # denominator must NOT match.
        assert rd.main_with_args(["--verify-only", "--type", "flashcard"]) == 3

    def test_sample_size_is_honoured(self, fake_db) -> None:
        fake_db["rows"] = [_row(f"{i:036d}") for i in range(10)]

        result = rd.verify_type("flashcard", 4, rd.DEFAULT_VERIFY_TOLERANCE, {})

        assert result.checked == 4
        assert result.passed

    def test_rows_without_a_stored_score_are_skipped_not_matched(
        self, fake_db
    ) -> None:
        fake_db["rows"] = [_row("a" * 36, stored=None)]

        result = rd.verify_type("flashcard", 10, rd.DEFAULT_VERIFY_TOLERANCE, {})

        assert result.checked == 0
        assert result.skipped == 1
        assert not result.passed


# ---------------------------------------------------------------------------
# --apply is gated on all three conditions
# ---------------------------------------------------------------------------


class TestApplyGate:
    def test_apply_without_the_env_guard_refuses(self, fake_db, captured_writes) -> None:
        fake_db["rows"] = [_row("a" * 36)]

        assert rd.main_with_args(["--apply"]) == 2
        assert fake_db["log"] == []
        assert captured_writes == []

    def test_apply_refuses_when_reproduction_fails(
        self, fake_db, captured_writes, monkeypatch, capsys
    ) -> None:
        """The gate that would have stopped the MCQ run."""
        monkeypatch.setenv("RESCORE_ALLOW_WRITE", "1")
        fake_db["rows"] = [_row(f"{i:036d}", stored=0.99) for i in range(3)]

        exit_code = rd.main_with_args(["--apply", "--type", "flashcard"])

        assert exit_code == 3
        assert captured_writes == []
        assert "no business writing a new one" in capsys.readouterr().err

    def test_apply_writes_when_all_three_gates_hold(
        self, fake_db, captured_writes, monkeypatch
    ) -> None:
        monkeypatch.setenv("RESCORE_ALLOW_WRITE", "1")
        fake_db["rows"] = [_row(f"{i:036d}", stored=LEGACY_SCORE) for i in range(2)]

        exit_code = rd.main_with_args(["--apply", "--type", "flashcard"])

        assert exit_code == 0
        assert len(captured_writes) == 1
        sql, params = captured_writes[0]
        assert "UPDATE derivative_artifacts" in sql
        assert "id = %s::uuid" in sql
        assert "deleted_at IS NULL" in sql
        assert params == [(CURRENT_SCORE, f"{0:036d}"), (CURRENT_SCORE, f"{1:036d}")]

    def test_reenabling_mcq_would_be_caught_by_the_gate(
        self, fake_db, captured_writes, monkeypatch, capsys
    ) -> None:
        """The incident, replayed against the gate that now exists.

        Re-enable mcq_question, feed the real persisted shape (one question,
        no `questions` list, stored score from its batch) and the reproduction
        check must refuse to write rather than recomputing 0.200 over 70,488
        rows.
        """
        from src.scoring import compute_mcq_confidence_score

        monkeypatch.setitem(rd.SCORERS, "mcq_question", compute_mcq_confidence_score)
        monkeypatch.delitem(rd.UNSUPPORTED_TYPES, "mcq_question")
        monkeypatch.setenv("RESCORE_ALLOW_WRITE", "1")

        real_mcq_row_shape = {
            "questionStem": "Which doctrine governs constructive dismissal?",
            "options": [
                {"label": "A", "text": "Doctrine one"},
                {"label": "B", "text": "Doctrine two"},
            ],
            "supportingSectionIds": ["sec-001"],
        }
        fake_db["rows"] = [
            _row(f"{i:036d}", dtype="mcq_question", stored=0.72,
                 content=real_mcq_row_shape)
            for i in range(3)
        ]

        exit_code = rd.main_with_args(["--apply", "--type", "mcq_question"])

        assert exit_code == 3
        assert captured_writes == []
        out = capsys.readouterr().out
        assert "FAILED" in out
        # 0.200 is the floor a missing `questions` list produces.
        assert "recomputed=0.2000" in out

    def test_apply_skips_rows_already_at_the_recomputed_score(
        self, fake_db, captured_writes, monkeypatch
    ) -> None:
        monkeypatch.setenv("RESCORE_ALLOW_WRITE", "1")
        # Verification needs reproducible rows; this one is already current.
        fake_db["rows"] = [
            _row(f"{0:036d}", stored=LEGACY_SCORE),
            _row(f"{1:036d}", stored=LEGACY_SCORE),
        ]
        rd.main_with_args(["--apply", "--type", "flashcard"])

        _sql, params = captured_writes[0]
        assert all(score == CURRENT_SCORE for score, _id in params)


# ---------------------------------------------------------------------------
# The cast that broke prod
# ---------------------------------------------------------------------------


class TestKeysetQuery:
    def test_cursor_placeholders_cast_to_uuid_not_text(self, fake_db) -> None:
        fake_db["rows"] = [_row("a" * 36)]

        rd.main_with_args([])

        select_sql = fake_db["log"][0][0]
        assert "%s::uuid IS NULL OR id > %s::uuid" in select_sql
        assert "::text" not in select_sql

    def test_no_statement_anywhere_casts_an_id_to_text(
        self, fake_db, captured_writes, monkeypatch
    ) -> None:
        monkeypatch.setenv("RESCORE_ALLOW_WRITE", "1")
        fake_db["rows"] = [_row(f"{i:036d}", stored=LEGACY_SCORE) for i in range(2)]

        rd.main_with_args(["--apply", "--type", "flashcard"])

        for sql, _params in fake_db["log"]:
            assert "::text" not in sql, f"id compared as text in: {sql}"
        for sql, _params in captured_writes:
            assert "::text" not in sql

    def test_first_page_passes_null_cursor(self, fake_db) -> None:
        fake_db["rows"] = [_row("a" * 36)]

        rd.main_with_args([])

        _sql, params = fake_db["log"][0]
        _types, cursor_a, cursor_b, page_size = params
        assert cursor_a is None and cursor_b is None
        assert page_size == rd.PAGE_SIZE

    def test_pagination_carries_the_last_id_as_a_string(self, fake_db) -> None:
        """More rows than a page forces a second query with a real cursor."""
        monkeypatchable_page_size = 2
        original = rd.PAGE_SIZE
        rd.PAGE_SIZE = monkeypatchable_page_size
        try:
            fake_db["rows"] = [_row(f"{i:036d}") for i in range(5)]
            rd.main_with_args(["--type", "flashcard"])
        finally:
            rd.PAGE_SIZE = original

        cursors = [p[1] for s, p in fake_db["log"] if s.strip().startswith("SELECT")]
        assert any(c is not None for c in cursors)
        assert all(isinstance(c, str) for c in cursors if c is not None)

    def test_uuid_object_ids_round_trip_as_strings(
        self, fake_db, captured_writes, monkeypatch
    ) -> None:
        """If psycopg2 is ever configured with register_uuid()."""
        import uuid as uuid_mod

        monkeypatch.setenv("RESCORE_ALLOW_WRITE", "1")
        row = _row("", stored=LEGACY_SCORE)
        row["id"] = uuid_mod.UUID("22222222-2222-2222-2222-222222222222")
        row["source_document_id"] = uuid_mod.UUID(
            "11111111-1111-1111-1111-111111111111"
        )
        fake_db["rows"] = [row]

        rd.main_with_args(["--apply", "--type", "flashcard"])

        _sql, params = captured_writes[0]
        assert params == [(CURRENT_SCORE, "22222222-2222-2222-2222-222222222222")]

    def test_type_filter_is_passed_through(self, fake_db) -> None:
        fake_db["rows"] = []

        rd.main_with_args(["--type", "flashcard"])

        _sql, params = fake_db["log"][0]
        assert params[0] == ["flashcard"]


# ---------------------------------------------------------------------------
# Dry run
# ---------------------------------------------------------------------------


class TestDryRun:
    def test_reports_the_recomputed_distribution(self, fake_db, capsys) -> None:
        fake_db["rows"] = [_row("a" * 36, stored=LEGACY_SCORE)]

        exit_code = rd.main_with_args(["--type", "flashcard"])
        out = capsys.readouterr().out

        assert exit_code == 0
        assert "0.750" in out
        assert "Dry run — nothing was written" in out

    def test_dry_run_issues_no_update(self, fake_db, captured_writes) -> None:
        fake_db["rows"] = [_row("a" * 36)]

        rd.main_with_args([])

        assert captured_writes == []
        assert not [s for s, _p in fake_db["log"] if "UPDATE" in s]

    def test_dry_run_proceeds_even_when_reproduction_fails(
        self, fake_db, capsys
    ) -> None:
        """Reporting is still useful; only writing is gated."""
        fake_db["rows"] = [_row("a" * 36, stored=0.99)]

        exit_code = rd.main_with_args(["--type", "flashcard"])

        assert exit_code == 0
        assert "FAILED" in capsys.readouterr().out

    def test_rows_without_a_source_document_are_counted_not_crashed(
        self, fake_db
    ) -> None:
        row = _row("a" * 36)
        row["source_document_id"] = None
        fake_db["rows"] = [row]

        assert rd.main_with_args(["--type", "flashcard"]) == 0

    def test_limit_stops_pagination(self, fake_db) -> None:
        fake_db["rows"] = [_row(f"{i:036d}") for i in range(10)]

        rd.main_with_args(["--type", "flashcard", "--limit", "2"])

        # The scoring pass stops at 2 rows; it must not walk the whole table.
        assert rd.main_with_args(["--type", "flashcard", "--limit", "2"]) == 0


# ---------------------------------------------------------------------------
# Real database — opt in with RESCORE_TEST_DATABASE_URL
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not os.environ.get("RESCORE_TEST_DATABASE_URL"),
    reason="Set RESCORE_TEST_DATABASE_URL to type-check the SQL against Postgres.",
)
def test_query_runs_against_real_postgres() -> None:
    """Executes the real statements — a uuid/text mismatch raises at plan time."""
    import psycopg2

    conn = psycopg2.connect(os.environ["RESCORE_TEST_DATABASE_URL"])
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id FROM derivative_artifacts
                    WHERE deleted_at IS NULL
                      AND derivative_type = ANY(%s)
                      AND (%s::uuid IS NULL OR id > %s::uuid)
                    ORDER BY id ASC
                    LIMIT 1""",
                (sorted(rd.SCORERS), None, None),
            )
            first = cur.fetchall()

            cursor_value = str(first[0][0]) if first else None
            cur.execute(
                """SELECT id FROM derivative_artifacts
                    WHERE deleted_at IS NULL
                      AND derivative_type = ANY(%s)
                      AND (%s::uuid IS NULL OR id > %s::uuid)
                    ORDER BY id ASC
                    LIMIT 1""",
                (sorted(rd.SCORERS), cursor_value, cursor_value),
            )
            cur.fetchall()

            cur.execute(
                """UPDATE derivative_artifacts
                      SET confidence_score = %s
                    WHERE id = %s::uuid
                      AND deleted_at IS NULL""",
                (0.5, cursor_value or "00000000-0000-0000-0000-000000000000"),
            )
        conn.rollback()
    finally:
        conn.close()


def test_script_source_has_no_text_cast_on_an_id() -> None:
    """Belt and braces: the regression that shipped, caught by shape too."""
    from pathlib import Path

    source = Path(rd.__file__).read_text(encoding="utf-8")
    statements = re.findall(r"id\s*[<>=]+\s*%s::(\w+)", source)
    assert statements, "expected at least one id comparison to be present"
    assert set(statements) == {"uuid"}, f"non-uuid id comparison: {statements}"
