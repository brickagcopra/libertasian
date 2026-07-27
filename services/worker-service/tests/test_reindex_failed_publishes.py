"""Tests for the failed-publish re-index recovery script.

Two invariants carry the weight here:

1. **Latest row per document wins.** A document whose index failed once and
   succeeded later must not be re-processed. That is why the flag filter lives
   outside the SQL ``WHERE`` — a ``WHERE ... = 'false'`` would find the stale
   failure row forever.
2. **Dry run writes nothing.** No index trigger, no audit row.

``audit_logs`` is append-only (no UPDATE/DELETE for the app role), so a third
test greps the source to keep it that way.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest

from src.scripts import reindex_failed_publishes as rfp

DOC_A = "11111111-1111-4111-8111-111111111111"
DOC_B = "22222222-2222-4222-8222-222222222222"
DOC_C = "33333333-3333-4333-8333-333333333333"


def _row(
    document_id: str,
    indexed: bool | None,
    created_at: str,
    *,
    action: str = rfp.ACTION_AUTO_PUBLISH,
    audit_id: str | None = None,
    source: str = "validate_and_publish",
) -> dict[str, Any]:
    """One audit_logs row as the query renders it (``->>`` gives strings)."""
    return {
        "entity_id": document_id,
        "audit_id": audit_id or f"audit-{document_id[:4]}-{created_at}",
        "action": action,
        "created_at": created_at,
        "indexed_flag": None if indexed is None else ("true" if indexed else "false"),
        "source": source,
    }


class FakeCursor:
    """Applies the contract of the DISTINCT ON query to an in-memory table."""

    def __init__(self, table: list[dict[str, Any]], calls: list[dict[str, Any]]):
        self._table = table
        self._calls = calls
        self._result: list[dict[str, Any]] = []

    def __enter__(self) -> FakeCursor:
        return self

    def __exit__(self, *exc: Any) -> None:
        return None

    def execute(self, sql: str, params: tuple[Any, ...]) -> None:
        actions, entity_type, last_id, _last_id_again, page_size = params
        self._calls.append({"sql": sql, "params": params})

        rows = [
            r
            for r in self._table
            if r["action"] in actions
            and r.get("entity_type", rfp.ENTITY_TYPE) == entity_type
            and (last_id is None or r["entity_id"] > last_id)
        ]
        # DISTINCT ON (entity_id) ORDER BY entity_id, created_at DESC, id DESC
        latest: dict[str, dict[str, Any]] = {}
        for r in rows:
            key = r["entity_id"]
            best = latest.get(key)
            if best is None or (r["created_at"], r["audit_id"]) > (
                best["created_at"],
                best["audit_id"],
            ):
                latest[key] = r
        self._result = [latest[k] for k in sorted(latest)][:page_size]

    def fetchall(self) -> list[dict[str, Any]]:
        return self._result


class FakeConn:
    def __init__(self, table: list[dict[str, Any]], calls: list[dict[str, Any]]):
        self._table = table
        self._calls = calls

    def __enter__(self) -> FakeConn:
        return self

    def __exit__(self, *exc: Any) -> None:
        return None

    def cursor(self, **_kwargs: Any) -> FakeCursor:
        return FakeCursor(self._table, self._calls)


@pytest.fixture
def audit_table(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Install a fake audit_logs table behind ``get_connection``."""
    state: dict[str, Any] = {"rows": [], "queries": []}
    monkeypatch.setattr(
        rfp, "get_connection", lambda: FakeConn(state["rows"], state["queries"])
    )
    return state


@pytest.fixture
def fake_writes(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Capture index triggers and audit writes; nothing leaves the process."""
    state: dict[str, Any] = {"triggered": [], "audits": [], "fail": set()}

    def fake_trigger(document_id: str) -> bool:
        state["triggered"].append(document_id)
        return document_id not in state["fail"]

    def fake_audit(**kwargs: Any) -> None:
        state["audits"].append(kwargs)

    monkeypatch.setattr(rfp.nestjs_client, "trigger_opensearch_index", fake_trigger)
    monkeypatch.setattr(rfp.db, "create_audit_log", fake_audit)
    return state


class TestLatestRowRule:
    def test_a_later_success_row_retires_an_earlier_failure(
        self, audit_table: dict[str, Any], fake_writes: dict[str, Any]
    ) -> None:
        audit_table["rows"] = [
            _row(DOC_A, False, "2026-07-01"),
            _row(DOC_A, True, "2026-07-05"),  # re-indexed later — leave alone
            _row(DOC_B, False, "2026-07-01"),
        ]
        report = rfp.run_reindex(dry_run=False)
        assert report["scanned"] == 2
        assert report["candidates"] == 1
        assert fake_writes["triggered"] == [DOC_B]

    def test_a_later_failure_row_reopens_an_earlier_success(
        self, audit_table: dict[str, Any], fake_writes: dict[str, Any]
    ) -> None:
        audit_table["rows"] = [
            _row(DOC_A, True, "2026-07-01"),
            _row(DOC_A, False, "2026-07-09"),
        ]
        rfp.run_reindex(dry_run=False)
        assert fake_writes["triggered"] == [DOC_A]

    def test_this_scripts_own_success_row_counts_as_the_latest_state(
        self, audit_table: dict[str, Any], fake_writes: dict[str, Any]
    ) -> None:
        # Idempotency: a second --apply run must be a no-op.
        audit_table["rows"] = [
            _row(DOC_A, False, "2026-07-01"),
            _row(
                DOC_A, True, "2026-07-02",
                action=rfp.ACTION_REINDEX, source="reindex_failed_publishes",
            ),
        ]
        report = rfp.run_reindex(dry_run=False)
        assert report["candidates"] == 0
        assert fake_writes["triggered"] == []

    def test_the_flag_is_not_filtered_in_sql(
        self, audit_table: dict[str, Any], fake_writes: dict[str, Any]
    ) -> None:
        """The rule only holds if the WHERE clause ignores the flag.

        Moving ``opensearch_indexed = 'false'`` into the WHERE would make the
        query return the latest *failure* instead of the latest row, and every
        already-recovered document would be re-processed on every run.
        """
        audit_table["rows"] = [_row(DOC_A, False, "2026-07-01")]
        rfp.run_reindex(dry_run=True)
        sql = audit_table["queries"][0]["sql"]
        where = sql.split("WHERE", 1)[1].split("ORDER BY", 1)[0]
        assert "opensearch_indexed" not in where
        assert "DISTINCT ON (entity_id)" in sql
        assert "ORDER BY entity_id, created_at DESC" in sql

    def test_both_publish_and_reindex_actions_are_ranked(
        self, audit_table: dict[str, Any], fake_writes: dict[str, Any]
    ) -> None:
        audit_table["rows"] = [_row(DOC_A, False, "2026-07-01")]
        rfp.run_reindex(dry_run=True)
        actions = audit_table["queries"][0]["params"][0]
        assert rfp.ACTION_AUTO_PUBLISH in actions
        assert rfp.ACTION_REINDEX in actions

    @pytest.mark.parametrize(
        ("flag", "expected"),
        [("false", True), ("true", False), (None, False)],
    )
    def test_needs_reindex_reads_only_the_flag(
        self, flag: str | None, expected: bool
    ) -> None:
        # A missing flag predates the flag and is not evidence of failure.
        assert rfp.needs_reindex({"indexed_flag": flag}) is expected

    def test_pagination_walks_by_entity_id(
        self, audit_table: dict[str, Any], fake_writes: dict[str, Any]
    ) -> None:
        audit_table["rows"] = [
            _row(DOC_A, False, "2026-07-01"),
            _row(DOC_B, False, "2026-07-01"),
            _row(DOC_C, False, "2026-07-01"),
        ]
        report = rfp.run_reindex(dry_run=True, page_size=1)
        assert report["scanned"] == 3
        assert report["still_failing_ids"] == [DOC_A, DOC_B, DOC_C]
        cursors = [q["params"][2] for q in audit_table["queries"]]
        assert cursors == [None, DOC_A, DOC_B, DOC_C]


class TestDryRun:
    def test_dry_run_writes_nothing(
        self, audit_table: dict[str, Any], fake_writes: dict[str, Any]
    ) -> None:
        audit_table["rows"] = [
            _row(DOC_A, False, "2026-07-01"),
            _row(DOC_B, False, "2026-07-01"),
        ]
        report = rfp.run_reindex(dry_run=True)
        assert fake_writes["triggered"] == []
        assert fake_writes["audits"] == []
        assert report["reindexed"] == 0
        assert report["dry_run"] is True

    def test_dry_run_is_the_default(
        self, audit_table: dict[str, Any], fake_writes: dict[str, Any]
    ) -> None:
        audit_table["rows"] = [_row(DOC_A, False, "2026-07-01")]
        rfp.run_reindex()
        assert fake_writes["triggered"] == []

    def test_dry_run_still_names_the_candidates(
        self, audit_table: dict[str, Any], fake_writes: dict[str, Any]
    ) -> None:
        audit_table["rows"] = [
            _row(DOC_A, False, "2026-07-01"),
            _row(DOC_B, True, "2026-07-01"),
            _row(DOC_C, False, "2026-07-01", source="backfill_autopublish_drafts"),
        ]
        report = rfp.run_reindex(dry_run=True)
        assert report["candidates"] == 2
        assert report["still_failing_ids"] == [DOC_A, DOC_C]
        assert report["sources"] == {
            "validate_and_publish": 1,
            "backfill_autopublish_drafts": 1,
        }

    def test_cli_dry_run_writes_no_index_call(
        self,
        audit_table: dict[str, Any],
        fake_writes: dict[str, Any],
        tmp_path: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        audit_table["rows"] = [_row(DOC_A, False, "2026-07-01")]
        out_file = tmp_path / "still-failing.txt"
        assert rfp.main_with_args(["--failures-file", str(out_file)]) == 0
        assert fake_writes["triggered"] == []
        assert fake_writes["audits"] == []
        assert "Dry run" in capsys.readouterr().out

    def test_apply_and_dry_run_together_is_an_error(
        self, audit_table: dict[str, Any], fake_writes: dict[str, Any]
    ) -> None:
        assert rfp.main_with_args(["--apply", "--dry-run"]) == 2
        assert fake_writes["triggered"] == []


class TestApply:
    def test_success_writes_one_new_audit_row(
        self, audit_table: dict[str, Any], fake_writes: dict[str, Any]
    ) -> None:
        audit_table["rows"] = [
            _row(DOC_A, False, "2026-07-01", audit_id="orig-a"),
        ]
        report = rfp.run_reindex(dry_run=False)
        assert report["reindexed"] == 1
        assert report["still_failing"] == 0
        assert len(fake_writes["audits"]) == 1
        entry = fake_writes["audits"][0]
        assert entry["action"] == rfp.ACTION_REINDEX
        assert entry["entity_id"] == DOC_A
        assert entry["metadata"]["opensearch_indexed"] is True
        assert entry["metadata"]["recovered_from_audit_id"] == "orig-a"

    def test_failure_writes_no_audit_row_and_is_reported(
        self, audit_table: dict[str, Any], fake_writes: dict[str, Any]
    ) -> None:
        audit_table["rows"] = [
            _row(DOC_A, False, "2026-07-01"),
            _row(DOC_B, False, "2026-07-01"),
        ]
        fake_writes["fail"] = {DOC_B}
        report = rfp.run_reindex(dry_run=False)
        assert report["reindexed"] == 1
        assert report["still_failing_ids"] == [DOC_B]
        # No audit row for the failure — the original stays the latest state,
        # so a re-run finds it again.
        assert [a["entity_id"] for a in fake_writes["audits"]] == [DOC_A]

    def test_limit_caps_candidates(
        self, audit_table: dict[str, Any], fake_writes: dict[str, Any]
    ) -> None:
        audit_table["rows"] = [
            _row(DOC_A, False, "2026-07-01"),
            _row(DOC_B, False, "2026-07-01"),
            _row(DOC_C, False, "2026-07-01"),
        ]
        report = rfp.run_reindex(dry_run=False, limit=2)
        assert report["candidates"] == 2
        assert fake_writes["triggered"] == [DOC_A, DOC_B]

    def test_cli_apply_reindexes_and_writes_the_failures_file(
        self,
        audit_table: dict[str, Any],
        fake_writes: dict[str, Any],
        tmp_path: Path,
    ) -> None:
        audit_table["rows"] = [
            _row(DOC_A, False, "2026-07-01"),
            _row(DOC_B, False, "2026-07-01"),
        ]
        fake_writes["fail"] = {DOC_B}
        out_file = tmp_path / "still-failing.txt"
        assert (
            rfp.main_with_args(["--apply", "--failures-file", str(out_file)]) == 0
        )
        assert fake_writes["triggered"] == [DOC_A, DOC_B]
        contents = out_file.read_text(encoding="utf-8")
        assert DOC_B in contents
        assert DOC_A not in contents


class TestAppendOnly:
    def test_source_never_updates_or_deletes_audit_logs(self) -> None:
        source = Path(rfp.__file__).read_text(encoding="utf-8")
        statements = re.findall(
            r"\b(UPDATE|DELETE\s+FROM)\s+audit_logs\b", source, re.IGNORECASE
        )
        assert statements == [], (
            "audit_logs is append-only — the app DB role has no UPDATE/DELETE "
            f"on it, but the script contains: {statements}"
        )

    def test_the_only_write_is_an_insert_via_create_audit_log(
        self, audit_table: dict[str, Any], fake_writes: dict[str, Any]
    ) -> None:
        audit_table["rows"] = [_row(DOC_A, False, "2026-07-01")]
        rfp.run_reindex(dry_run=False)
        # Nothing in this script issues raw SQL writes; the audit row goes
        # through the shared INSERT helper.
        assert audit_table["queries"]
        assert all(
            q["sql"].strip().startswith("SELECT") for q in audit_table["queries"]
        )
        assert len(fake_writes["audits"]) == 1


class TestFailuresFile:
    def test_dry_run_file_is_labelled_as_candidates(self, tmp_path: Path) -> None:
        path = tmp_path / "out.txt"
        rfp.write_failures_file(str(path), [DOC_A, DOC_B], dry_run=True)
        lines = path.read_text(encoding="utf-8").splitlines()
        assert lines[0].startswith("# candidates")
        assert lines[1:] == [DOC_A, DOC_B]

    def test_apply_file_is_labelled_as_still_failing(self, tmp_path: Path) -> None:
        path = tmp_path / "out.txt"
        rfp.write_failures_file(str(path), [DOC_A], dry_run=False)
        lines = path.read_text(encoding="utf-8").splitlines()
        assert lines[0].startswith("# still failing")
        assert lines[1:] == [DOC_A]
