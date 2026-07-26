"""Execution-path tests for the derivative re-score script.

The script shipped with no test that ran a single line of its DB code, so a
``%s::text`` cast against a ``uuid`` column reached prod and failed on the
first page with ``operator does not exist: uuid > text`` — it never read a
row. Asserting the report formatting was not enough; these tests drive
``main()`` through a fake connection so the SQL, the parameters and the
pagination all execute.

``test_query_runs_against_real_postgres`` runs the actual statement against a
real database when ``RESCORE_TEST_DATABASE_URL`` is set, and skips otherwise.
That is the only check here that would have caught the cast by *type-checking*
rather than by pattern — run it before trusting a change to these queries.
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


def _flashcard_content(cited: int, cards: int = 5) -> dict[str, Any]:
    """A deck of `cards` cards, the first `cited` of them grounded."""
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


def _row(artifact_id: str, *, cited: int = 5, before: float = 0.5625) -> dict[str, Any]:
    return {
        "id": artifact_id,
        "derivative_type": "flashcard",
        "source_document_id": "11111111-1111-1111-1111-111111111111",
        "content_json": _flashcard_content(cited),
        "confidence_score": before,
    }


class FakeCursor:
    """Records every statement and hands back canned pages."""

    def __init__(self, pages: list[list[dict[str, Any]]], log: list[tuple[str, Any]]):
        self._pages = pages
        self._log = log
        self._rows: list[dict[str, Any]] = []

    def __enter__(self) -> FakeCursor:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def execute(self, sql: str, params: Any = None) -> None:
        self._log.append((sql, params))
        self._rows = self._pages.pop(0) if self._pages else []

    def fetchall(self) -> list[dict[str, Any]]:
        return self._rows


class FakeConnection:
    def __init__(self, pages: list[list[dict[str, Any]]], log: list[tuple[str, Any]]):
        self._pages = pages
        self._log = log
        self.commits = 0

    def __enter__(self) -> FakeConnection:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def cursor(self, **kwargs: Any) -> FakeCursor:
        return FakeCursor(self._pages, self._log)

    def commit(self) -> None:
        self.commits += 1


@pytest.fixture
def fake_db(monkeypatch: pytest.MonkeyPatch):
    """Wire the script to a fake connection and a fixed section set."""
    state: dict[str, Any] = {"pages": [], "log": []}

    def _get_connection() -> FakeConnection:
        return FakeConnection(state["pages"], state["log"])

    monkeypatch.setattr(rd, "get_connection", _get_connection)
    monkeypatch.setattr(
        rd.db, "get_document_sections_for_digest", lambda _doc_id: SOURCE_SECTIONS
    )
    return state


# ---------------------------------------------------------------------------
# The cast that broke prod
# ---------------------------------------------------------------------------


class TestKeysetQuery:
    def test_cursor_placeholders_cast_to_uuid_not_text(self, fake_db) -> None:
        fake_db["pages"] = [[_row("a" * 36)], []]

        rd.main_with_args([])

        select_sql = fake_db["log"][0][0]
        assert "%s::uuid IS NULL OR id > %s::uuid" in select_sql
        assert "::text" not in select_sql

    def test_no_statement_anywhere_casts_an_id_to_text(self, fake_db) -> None:
        """Covers the write path too, not just the query that threw."""
        fake_db["pages"] = [[_row("a" * 36)], []]

        rd.main_with_args([])

        for sql, _params in fake_db["log"]:
            assert "::text" not in sql, f"id compared as text in: {sql}"

    def test_first_page_passes_null_cursor(self, fake_db) -> None:
        fake_db["pages"] = [[_row("a" * 36)], []]

        rd.main_with_args([])

        _sql, params = fake_db["log"][0]
        types, cursor_a, cursor_b, page_size = params
        assert cursor_a is None and cursor_b is None
        assert page_size == rd.PAGE_SIZE
        assert types == sorted(rd.SCORERS)

    def test_second_page_carries_the_last_id_as_a_string(self, fake_db) -> None:
        """psycopg2 adapts a str to uuid; a uuid.UUID would need register_uuid."""
        first = [_row(f"{i:036d}") for i in range(3)]
        fake_db["pages"] = [first, []]

        rd.main_with_args([])

        assert len(fake_db["log"]) >= 2
        _sql, params = fake_db["log"][1]
        assert params[1] == f"{2:036d}"
        assert isinstance(params[1], str)

    def test_type_filter_is_passed_through(self, fake_db) -> None:
        fake_db["pages"] = [[], []]

        rd.main_with_args(["--type", "flashcard"])

        _sql, params = fake_db["log"][0]
        assert params[0] == ["flashcard"]

    def test_limit_stops_pagination(self, fake_db) -> None:
        fake_db["pages"] = [[_row(f"{i:036d}") for i in range(3)], []]

        rd.main_with_args(["--limit", "2"])

        # One SELECT only: the limit is reached inside the first page.
        selects = [s for s, _p in fake_db["log"] if s.strip().startswith("SELECT")]
        assert len(selects) == 1


# ---------------------------------------------------------------------------
# Scoring + reporting over the fake rows
# ---------------------------------------------------------------------------


class TestDryRun:
    def test_recomputes_and_reports_newly_eligible(self, fake_db, capsys) -> None:
        fake_db["pages"] = [[_row("a" * 36, cited=5, before=0.5625)], []]

        exit_code = rd.main_with_args([])
        out = capsys.readouterr().out

        assert exit_code == 0
        # 5 cards, 5 cited -> citable min(40, 10) = 10 -> coverage 0.5 -> 0.75
        assert "0.750" in out
        assert "Dry run — nothing was written" in out

    def test_dry_run_issues_no_update(self, fake_db) -> None:
        fake_db["pages"] = [[_row("a" * 36)], []]

        rd.main_with_args([])

        assert not [s for s, _p in fake_db["log"] if "UPDATE" in s]

    def test_rows_without_a_source_document_are_counted_not_crashed(
        self, fake_db
    ) -> None:
        row = _row("a" * 36)
        row["source_document_id"] = None
        fake_db["pages"] = [[row], []]

        exit_code = rd.main_with_args([])

        assert exit_code == 0

    def test_uuid_object_ids_round_trip_as_strings(self, fake_db) -> None:
        """If psycopg2 is ever configured with register_uuid()."""
        import uuid as uuid_mod

        row = _row("a" * 36)
        row["id"] = uuid_mod.UUID("22222222-2222-2222-2222-222222222222")
        row["source_document_id"] = uuid_mod.UUID(
            "11111111-1111-1111-1111-111111111111"
        )
        fake_db["pages"] = [[row], []]

        rd.main_with_args([])

        _sql, params = fake_db["log"][1]
        assert params[1] == "22222222-2222-2222-2222-222222222222"
        assert isinstance(params[1], str)


# ---------------------------------------------------------------------------
# --apply
# ---------------------------------------------------------------------------


class TestApply:
    def test_apply_without_the_env_guard_refuses_and_writes_nothing(
        self, fake_db, monkeypatch
    ) -> None:
        monkeypatch.delenv("RESCORE_ALLOW_WRITE", raising=False)
        fake_db["pages"] = [[_row("a" * 36)], []]

        exit_code = rd.main_with_args(["--apply"])

        assert exit_code == 2
        assert fake_db["log"] == []

    def test_apply_with_the_guard_writes_only_changed_rows(
        self, fake_db, monkeypatch
    ) -> None:
        monkeypatch.setenv("RESCORE_ALLOW_WRITE", "1")
        batched: list[tuple[str, list[tuple[float, str]]]] = []

        def _fake_execute_batch(cur: Any, sql: str, params: list[Any]) -> None:
            batched.append((sql, params))

        monkeypatch.setattr(
            rd.psycopg2.extras, "execute_batch", _fake_execute_batch
        )
        # One row that changes, one already at its recomputed score.
        unchanged = _row("b" * 36, cited=5, before=0.75)
        fake_db["pages"] = [[_row("a" * 36, before=0.5625), unchanged], []]

        exit_code = rd.main_with_args(["--apply"])

        assert exit_code == 0
        assert len(batched) == 1
        sql, params = batched[0]
        assert "UPDATE derivative_artifacts" in sql
        assert "id = %s::uuid" in sql
        assert "deleted_at IS NULL" in sql
        assert params == [(0.75, "a" * 36)]

    def test_write_params_are_score_then_string_id(self, fake_db, monkeypatch) -> None:
        """Order matters: SET comes before WHERE in the statement."""
        monkeypatch.setenv("RESCORE_ALLOW_WRITE", "1")
        captured: list[list[tuple[Any, Any]]] = []
        monkeypatch.setattr(
            rd.psycopg2.extras,
            "execute_batch",
            lambda cur, sql, params: captured.append(params),
        )
        fake_db["pages"] = [[_row("c" * 36, before=0.1)], []]

        rd.main_with_args(["--apply"])

        (score, artifact_id), = captured[0]
        assert isinstance(score, float)
        assert isinstance(artifact_id, str)


# ---------------------------------------------------------------------------
# Real database — opt in with RESCORE_TEST_DATABASE_URL
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not os.environ.get("RESCORE_TEST_DATABASE_URL"),
    reason="Set RESCORE_TEST_DATABASE_URL to type-check the SQL against Postgres.",
)
def test_query_runs_against_real_postgres() -> None:
    """Executes the real statement — the check that would have caught the cast.

    A ``uuid > text`` comparison raises at plan time, so this fails whether or
    not the table has rows.
    """
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

            # And the paginated form, with a real cursor value.
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

            # The write statement, planned but rolled back.
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
