"""Tests for the read-only bar exam parse audit.

The most important test in this file is the one that greps the source for
write verbs: the script is meant to be safe to point at prod, and "it only
reads" is a property that decays the moment someone adds a convenient
``--fix`` flag. The rest check that the MISMATCH flag means what the report
says it means — a sitting holding 4 questions on a page with 22 must flag,
and a sitting that agrees with its page must not.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.fetchers.base import FetchedContent
from src.scripts import audit_bar_exam_parse as audit

FIXTURES = Path(__file__).parent / "fixtures" / "lawphil_bar"


def _load(name: str) -> str:
    return (FIXTURES / name).read_bytes().decode("windows-1252", errors="replace")


def _row(**overrides) -> audit.AuditRow:
    defaults = dict(
        year=2015,
        subject_slug="criminalQ",
        subject_study_code="criminal_law",
        sitting_id="sit-1",
        document_id="doc-1",
        stored_questions=22,
        parsed_questions=22,
        expected_items=22,
        page_format="ordered_list",
    )
    defaults.update(overrides)
    return audit.AuditRow(**defaults)


class TestNoWritePath:
    def test_source_contains_no_write_path(self) -> None:
        source = Path(audit.__file__).read_text(encoding="utf-8")
        code = re.sub(r'""".*?"""', "", source, flags=re.DOTALL)
        for forbidden in (
            "UPDATE ",
            "INSERT ",
            "DELETE ",
            "commit(",
            "--apply",
            "--fix",
        ):
            assert forbidden not in code, (
                f"write path present in {audit.__name__}: {forbidden}"
            )

    def test_it_never_imports_the_ingest_task(self) -> None:
        """Importing the task would put a writing code path one call away."""
        source = Path(audit.__file__).read_text(encoding="utf-8")
        assert "ingest_sitting" not in source
        assert "ingestion_db_client" not in source


class TestMismatchFlag:
    def test_agreement_is_not_a_mismatch(self) -> None:
        assert _row().mismatch is False

    def test_the_2015_shape_flags(self) -> None:
        """stored=4 parsed=22 expected=22 — the row this script exists for."""
        assert _row(stored_questions=4).mismatch is True

    def test_a_parse_that_disagrees_with_the_page_flags(self) -> None:
        """Even when storage agrees with the parse, the page can disagree with
        both — that is a parser that is wrong in a stable way."""
        assert _row(stored_questions=10, parsed_questions=10,
                    expected_items=22).mismatch is True

    def test_a_page_that_declares_nothing_is_judged_on_stored_vs_parsed(
        self,
    ) -> None:
        assert _row(expected_items=None).mismatch is False
        assert _row(expected_items=None, stored_questions=4).mismatch is True

    def test_a_sitting_that_does_not_exist_yet_is_not_a_mismatch(self) -> None:
        """Nothing is stored, so nothing can disagree."""
        assert _row(sitting_id=None, stored_questions=None).mismatch is False

    def test_a_fetch_error_flags(self) -> None:
        """An audit that could not read the page has not cleared it."""
        assert _row(error="ConnectError: timed out").mismatch is True

    def test_a_page_that_parses_to_nothing_flags(self) -> None:
        assert _row(parsed_questions=None).mismatch is True


class TestAuditOne:
    def _fetcher(self, html: str) -> MagicMock:
        fetcher = MagicMock()
        fetcher.fetch_content.return_value = FetchedContent(
            url="https://lawphil.net/courts/bm/barQ/2015/criminalQ.html",
            html=html,
            status_code=200,
            content_type="text/html",
            fetched_at="2026-09-14T18:00:00+00:00",
        )
        return fetcher

    def test_it_reports_all_three_counts_for_a_broken_sitting(self) -> None:
        stored = {
            (2015, "criminal_law"): {
                "sitting_id": "sit-1",
                "document_id": "doc-1",
                "questions": 4,
            },
        }

        row = audit.audit_one(
            2015, "criminalQ", stored, self._fetcher(_load("2015_criminal.html")),
        )

        assert row.stored_questions == 4
        assert row.parsed_questions == 22
        assert row.expected_items == 22
        assert row.page_format == "ordered_list"
        assert row.mismatch is True

    def test_a_fetch_failure_is_recorded_not_raised(self) -> None:
        """One unreachable page must not end a 100-page audit."""
        fetcher = MagicMock()
        fetcher.fetch_content.side_effect = RuntimeError("connection reset")

        row = audit.audit_one(2015, "criminalQ", {}, fetcher)

        assert row.error is not None
        assert "connection reset" in row.error
        assert row.parsed_questions is None
        assert row.mismatch is True

    def test_an_unknown_slug_is_recorded_without_fetching(self) -> None:
        fetcher = MagicMock()

        row = audit.audit_one(2015, "notaslugQ", {}, fetcher)

        assert row.error == "unknown_subject_slug:notaslugQ"
        fetcher.fetch_content.assert_not_called()


class TestFetchWindow:
    def test_it_refuses_to_run_outside_the_window(self) -> None:
        """~100 requests is exactly what the window exists to keep off
        LawPhil during PH business hours."""
        with patch.object(audit, "is_in_fetch_window", return_value=False), \
                patch("sys.argv", ["audit_bar_exam_parse"]), \
                pytest.raises(SystemExit) as excinfo:
            audit.main()

        assert "fetch window" in str(excinfo.value)

    def test_force_window_overrides_it(self) -> None:
        with patch.object(audit, "is_in_fetch_window", return_value=False), \
                patch.object(audit, "stored_counts", return_value={}) as counts, \
                patch.object(audit, "LawphilBarFetcher") as fetcher_cls, \
                patch.object(audit, "audit_one", return_value=_row()), \
                patch(
                    "sys.argv",
                    ["audit_bar_exam_parse", "--years", "2015", "--force-window"],
                ):
            audit.main()

        counts.assert_called_once()
        fetcher_cls.assert_called_once()

    def test_inside_the_window_no_flag_is_needed(self) -> None:
        with patch.object(audit, "is_in_fetch_window", return_value=True), \
                patch.object(audit, "stored_counts", return_value={}), \
                patch.object(audit, "LawphilBarFetcher"), \
                patch.object(audit, "audit_one", return_value=_row()) as one, \
                patch("sys.argv", ["audit_bar_exam_parse", "--years", "2015"]):
            audit.main()

        assert one.called


class TestReport:
    def test_the_table_names_the_mismatch(self) -> None:
        text = audit.format_table([_row(stored_questions=4), _row()])

        assert "MISMATCH" in text
        assert "1 flagged MISMATCH" in text
        assert "2 sitting(s) audited" in text

    def test_mismatches_only_filters_the_clean_rows(self, capsys) -> None:
        """The 2015 run is several sittings; only the broken ones matter."""
        with patch.object(audit, "is_in_fetch_window", return_value=True), \
                patch.object(audit, "stored_counts", return_value={}), \
                patch.object(audit, "LawphilBarFetcher"), \
                patch.object(
                    audit, "audit_one", side_effect=lambda y, s, st, f: _row(
                        subject_slug=s,
                        stored_questions=4 if s == "criminalQ" else 22,
                    ),
                ), \
                patch(
                    "sys.argv",
                    ["audit_bar_exam_parse", "--years", "2015",
                     "--mismatches-only", "--json"],
                ):
            audit.main()

        payload = json.loads(capsys.readouterr().out)
        assert [row["subject_slug"] for row in payload] == ["criminalQ"]
        assert payload[0]["mismatch"] is True
        assert payload[0]["stored_questions"] == 4

    def test_an_empty_year_selection_is_an_error_not_an_empty_report(
        self,
    ) -> None:
        with patch.object(audit, "is_in_fetch_window", return_value=True), \
                patch("sys.argv", ["audit_bar_exam_parse", "--years", "1999"]), \
                pytest.raises(SystemExit) as excinfo:
            audit.main()

        assert "1999" in str(excinfo.value)
