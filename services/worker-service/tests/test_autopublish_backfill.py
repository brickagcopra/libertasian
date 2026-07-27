"""Tests for ``ingestion.backfill_autopublish_drafts``.

These cover the mechanics — pagination, the dry-run write barrier, verdict
tallying, error containment — NOT whether the corrected rules are right for
the corpus. That question is answered by the dry-run report over live rows,
because the thing that made the old gate look reasonable was precisely a
fixture-shaped assumption about how often citations resolve.

Rows here therefore carry the live shape: ~16 citations per document, none
resolved. Under the old blocking rule every one of them would go to review.

``ingestion_db_client`` and ``nestjs_client`` are patched at the names the
task module imported them under.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from src.tasks import autopublish_backfill_tasks as backfill

from .conftest import make_uuid

# ─── Fixtures ──────────────────────────────────────────────────────────


def _draft_row(**overrides: Any) -> dict[str, Any]:
    """A complete draft document whose citations do not resolve.

    This is the median live row: high-trust source, sections, title, court,
    decision date, ~16 citations, 0 of them resolved.
    """
    row: dict[str, Any] = {
        "id": make_uuid(),
        "title": "Republic v. Sandiganbayan",
        "document_type": "case",
        "court": "Supreme Court",
        "decision_date": "2026-06-11",
        "gr_no": "G.R. No. 260233",
        "status": "draft",
        "truthfulness_status": "needs_review",
        "is_published": False,
        "source_id": make_uuid(),
        "source_trust_level": "high",
        "section_count": 3,
        "total_citations": 16,
        "resolved_citations": 0,
        "open_flags": [],
    }
    row.update(overrides)
    return row


@pytest.fixture()
def mock_db() -> Any:
    with patch.object(backfill, "db") as mock:
        mock.get_draft_documents_for_validation_after.return_value = []
        yield mock


@pytest.fixture()
def mock_nestjs() -> Any:
    with patch.object(backfill, "nestjs_client") as mock:
        mock.trigger_opensearch_index.return_value = True
        yield mock


def _pages(mock_db: Any, *pages: list[dict[str, Any]]) -> None:
    """Program the keyset walk with successive pages."""
    mock_db.get_draft_documents_for_validation_after.side_effect = [*pages, []]


# ─── Dry run ───────────────────────────────────────────────────────────


class TestDryRun:
    """Dry run is the default and must not write anything."""

    def test_dry_run_is_the_default(self, mock_db: Any, mock_nestjs: Any) -> None:
        _pages(mock_db, [_draft_row()])
        report = backfill.run_backfill()
        assert report["dry_run"] is True

    def test_dry_run_writes_nothing(self, mock_db: Any, mock_nestjs: Any) -> None:
        _pages(mock_db, [_draft_row() for _ in range(5)])

        report = backfill.run_backfill(dry_run=True)

        mock_db.publish_document.assert_not_called()
        mock_db.create_audit_log.assert_not_called()
        mock_nestjs.trigger_opensearch_index.assert_not_called()
        assert report["would_publish"] == 5
        assert report["published"] == 0

    def test_dry_run_counts_documents_the_old_gate_held(
        self, mock_db: Any, mock_nestjs: Any
    ) -> None:
        """Unresolved citations + otherwise complete = the stranded population."""
        _pages(mock_db, [_draft_row() for _ in range(3)])

        report = backfill.run_backfill()

        assert report["verdicts"] == {"publish": 3}
        assert report["publishes_with_failing_citation_check"] == 3

    def test_resolved_citations_publish_without_the_advisory_tally(
        self, mock_db: Any, mock_nestjs: Any
    ) -> None:
        _pages(mock_db, [_draft_row(total_citations=10, resolved_citations=10)])

        report = backfill.run_backfill()

        assert report["would_publish"] == 1
        assert report["publishes_with_failing_citation_check"] == 0


# ─── Verdict tallying ──────────────────────────────────────────────────


class TestVerdicts:
    def test_blocking_failure_routes_to_review_and_is_attributed(
        self, mock_db: Any, mock_nestjs: Any
    ) -> None:
        _pages(mock_db, [_draft_row(source_trust_level="medium")])

        report = backfill.run_backfill()

        assert report["verdicts"] == {"human_review": 1}
        assert report["blocking_failures"] == {"official_source": 1}

    def test_citation_check_never_appears_in_blocking_failures(
        self, mock_db: Any, mock_nestjs: Any
    ) -> None:
        """It is advisory — it must not be reported as a reason for review."""
        _pages(mock_db, [_draft_row(decision_date=None)])

        report = backfill.run_backfill()

        assert "citation_mapping" not in report["blocking_failures"]
        assert report["blocking_failures"] == {"document_complete": 1}

    def test_quarantine_verdict_writes_nothing_even_when_applying(
        self, mock_db: Any, mock_nestjs: Any
    ) -> None:
        """A sweep reports quarantine candidates; it does not quarantine them."""
        _pages(
            mock_db,
            [_draft_row(open_flags=[{"severity": "high", "status": "open"}])],
        )

        report = backfill.run_backfill(dry_run=False)

        assert report["verdicts"] == {"quarantine": 1}
        mock_db.quarantine_document.assert_not_called()
        mock_db.publish_document.assert_not_called()

    def test_already_settled_rows_are_skipped(
        self, mock_db: Any, mock_nestjs: Any
    ) -> None:
        _pages(
            mock_db,
            [_draft_row(truthfulness_status="verified"), _draft_row()],
        )

        report = backfill.run_backfill(dry_run=False)

        assert report["skipped_already_settled"] == 1
        assert report["published"] == 1


# ─── Apply path ────────────────────────────────────────────────────────


class TestApply:
    def test_publish_indexes_and_audits_each_document(
        self, mock_db: Any, mock_nestjs: Any
    ) -> None:
        row = _draft_row()
        _pages(mock_db, [row])

        report = backfill.run_backfill(dry_run=False)

        mock_db.publish_document.assert_called_once_with(row["id"])
        mock_nestjs.trigger_opensearch_index.assert_called_once_with(row["id"])
        audit = mock_db.create_audit_log.call_args.kwargs
        assert audit["action"] == "document.auto_publish"
        assert audit["entity_id"] == row["id"]
        assert audit["metadata"]["source"] == "backfill_autopublish_drafts"
        assert report["published"] == 1

    def test_audit_metadata_records_the_advisory_shortfall(
        self, mock_db: Any, mock_nestjs: Any
    ) -> None:
        """Publishing over a failed citation check stays visible on the record."""
        _pages(mock_db, [_draft_row()])

        backfill.run_backfill(dry_run=False)

        reasons = mock_db.create_audit_log.call_args.kwargs["metadata"]["reasons"]
        assert any("Advisory (non-blocking)" in r for r in reasons)

    def test_index_failure_is_counted_but_does_not_stop_the_sweep(
        self, mock_db: Any, mock_nestjs: Any
    ) -> None:
        _pages(mock_db, [_draft_row(), _draft_row()])
        mock_nestjs.trigger_opensearch_index.side_effect = [False, True]

        report = backfill.run_backfill(dry_run=False)

        assert report["published"] == 2
        assert report["index_failures"] == 1

    def test_one_failing_row_does_not_abort_the_sweep(
        self, mock_db: Any, mock_nestjs: Any
    ) -> None:
        bad, good = _draft_row(), _draft_row()
        _pages(mock_db, [bad, good])
        mock_db.publish_document.side_effect = [
            RuntimeError("deadlock detected"),
            None,
        ]

        report = backfill.run_backfill(dry_run=False)

        assert report["publish_errors"] == 1
        assert report["published"] == 1
        assert report["error_samples"][0]["document_id"] == bad["id"]


# ─── Pagination ────────────────────────────────────────────────────────


class TestPagination:
    def test_walks_pages_until_short_page(
        self, mock_db: Any, mock_nestjs: Any
    ) -> None:
        first = [_draft_row() for _ in range(2)]
        second = [_draft_row()]
        _pages(mock_db, first, second)

        report = backfill.run_backfill(page_size=2)

        assert report["scanned"] == 3
        # Short second page ends the walk — no third query.
        assert mock_db.get_draft_documents_for_validation_after.call_count == 2

    def test_cursor_advances_to_last_id_of_page(
        self, mock_db: Any, mock_nestjs: Any
    ) -> None:
        first = [_draft_row() for _ in range(2)]
        _pages(mock_db, first, [_draft_row()])

        backfill.run_backfill(page_size=2)

        calls = mock_db.get_draft_documents_for_validation_after.call_args_list
        assert calls[0].args[0] is None
        assert calls[1].args[0] == str(first[-1]["id"])

    def test_limit_stops_the_walk_mid_page(
        self, mock_db: Any, mock_nestjs: Any
    ) -> None:
        _pages(mock_db, [_draft_row() for _ in range(5)])

        report = backfill.run_backfill(limit=2, page_size=5)

        assert report["scanned"] == 2

    def test_progress_callback_fires_on_the_configured_interval(
        self, mock_db: Any, mock_nestjs: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(backfill, "PROGRESS_EVERY", 2)
        _pages(mock_db, [_draft_row() for _ in range(4)])
        seen: list[int] = []

        backfill.run_backfill(on_progress=lambda r: seen.append(r["scanned"]))

        assert seen == [2, 4]


# ─── CLI ───────────────────────────────────────────────────────────────


class TestCli:
    """The CLI is the path a human runs against prod — gate it properly."""

    def test_apply_without_env_var_refuses_and_runs_nothing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.scripts import backfill_autopublish_drafts as cli

        monkeypatch.delenv(cli.WRITE_ENV_VAR, raising=False)
        with patch.object(cli, "run_backfill") as run:
            assert cli.main_with_args(["--apply"]) == 2
            run.assert_not_called()

    def test_apply_with_env_var_runs_with_dry_run_false(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.scripts import backfill_autopublish_drafts as cli

        monkeypatch.setenv(cli.WRITE_ENV_VAR, "1")
        with patch.object(cli, "run_backfill") as run:
            run.return_value = _empty_report(dry_run=False)
            assert cli.main_with_args(["--apply"]) == 0
            assert run.call_args.kwargs["dry_run"] is False

    def test_default_invocation_is_a_dry_run(self) -> None:
        from src.scripts import backfill_autopublish_drafts as cli

        with patch.object(cli, "run_backfill") as run:
            run.return_value = _empty_report(dry_run=True)
            assert cli.main_with_args([]) == 0
            assert run.call_args.kwargs["dry_run"] is True

    def test_report_renders_without_a_key_error(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """The report dict and its renderer must not drift apart."""
        from src.scripts import backfill_autopublish_drafts as cli

        with patch.object(backfill, "db") as mock_db, \
                patch.object(backfill, "nestjs_client"):
            _pages(
                mock_db,
                [_draft_row(), _draft_row(source_trust_level="low")],
            )
            cli.print_report(backfill.run_backfill())

        out = capsys.readouterr().out
        assert "WOULD PUBLISH" in out
        assert "official_source" in out
        assert "Dry run" in out


# ─── The page query ────────────────────────────────────────────────────


class TestDraftPageQuery:
    """The SQL that feeds the sweep. No connection is opened.

    The rescore script shipped a ``::text`` cast on a ``@db.Uuid`` cursor and
    died on prod with ``operator does not exist`` without reading a row. These
    assertions pin the cast so that failure cannot repeat here.
    """

    @pytest.fixture()
    def cursor(self) -> Any:
        with patch("src.clients.db_client.psycopg2.connect") as connect:
            conn = MagicMock()
            cur = MagicMock()
            conn.cursor.return_value.__enter__.return_value = cur
            conn.cursor.return_value.__exit__.return_value = False
            cur.fetchall.return_value = []
            connect.return_value = conn
            yield cur

    def _sql(self, cursor: Any) -> str:
        return cursor.execute.call_args.args[0]

    def test_cursor_is_cast_to_uuid_not_text(self, cursor: Any) -> None:
        from src.clients.ingestion_db_client import (
            get_draft_documents_for_validation_after,
        )

        get_draft_documents_for_validation_after(make_uuid(), 500)
        sql = self._sql(cursor)
        assert "%s::uuid IS NULL OR d.id > %s::uuid" in sql
        assert "::text" not in sql

    def test_selects_only_drafts_ordered_for_keyset_paging(
        self, cursor: Any
    ) -> None:
        from src.clients.ingestion_db_client import (
            get_draft_documents_for_validation_after,
        )

        get_draft_documents_for_validation_after(None, 500)
        sql = self._sql(cursor)
        assert "d.status = 'draft'" in sql
        assert "ORDER BY d.id ASC" in sql
        assert cursor.execute.call_args.args[1] == (None, None, 500)

    def test_supplies_every_validator_input(self, cursor: Any) -> None:
        """A column dropped here becomes a silently wrong verdict."""
        from src.clients.ingestion_db_client import (
            get_draft_documents_for_validation_after,
        )

        get_draft_documents_for_validation_after(None, 500)
        sql = self._sql(cursor)
        for column in (
            "d.title",
            "d.document_type",
            "d.court",
            "d.decision_date",
            "s.trust_level AS source_trust_level",
            "AS section_count",
            "AS total_citations",
            "AS resolved_citations",
            "AS open_flags",
        ):
            assert column in sql, f"missing {column!r}"

    def test_open_flags_are_limited_to_open_status(self, cursor: Any) -> None:
        """Quarantine keys off open high-severity flags — resolved ones must
        not be handed to the validator."""
        from src.clients.ingestion_db_client import (
            get_draft_documents_for_validation_after,
        )

        get_draft_documents_for_validation_after(None, 500)
        assert "f.status = 'open'" in self._sql(cursor)


def _empty_report(*, dry_run: bool) -> dict[str, Any]:
    return {
        "dry_run": dry_run,
        "scanned": 0,
        "skipped_already_settled": 0,
        "verdicts": {},
        "would_publish": 0,
        "published": 0,
        "publishes_with_failing_citation_check": 0,
        "blocking_failures": {},
        "quarantine_reasons": {},
        "index_failures": 0,
        "publish_errors": 0,
        "error_samples": [],
    }


# ─── Celery entry point ────────────────────────────────────────────────


def test_task_defaults_to_dry_run() -> None:
    with patch.object(backfill, "run_backfill") as run:
        run.return_value = _empty_report(dry_run=True)
        backfill.backfill_autopublish_drafts()
        assert run.call_args.kwargs["dry_run"] is True
