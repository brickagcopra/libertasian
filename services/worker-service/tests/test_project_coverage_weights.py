"""Tests for the read-only prod projection script.

The projection is the acceptance gate for the taper, so it has to be right
about two things: it must never write, and its MCQ batch reconstruction must
refuse to report a number it cannot prove it read correctly.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest

from src.scripts import project_coverage_weights as pcw

SHORT_SOURCE = [
    {"id": f"sec-{i:03d}", "plain_text": f"Section {i}."} for i in range(3)
]


def _deck(cited: int = 5, cards: int = 5) -> dict[str, Any]:
    return {
        "cards": [
            {
                "front": f"Q{i}",
                "back": f"A{i}",
                "supportingSectionIds": [f"sec-{i % 3:03d}"] if i < cited else [],
            }
            for i in range(cards)
        ],
    }


def _question(index: int, cited: bool = True) -> dict[str, Any]:
    return {
        "questionStem": f"Question {index}?",
        "options": [{"label": "A", "text": "one"}, {"label": "B", "text": "two"}],
        "supportingSectionIds": [f"sec-{index % 3:03d}"] if cited else [],
    }


def _row(
    artifact_id: str,
    dtype: str,
    content: dict[str, Any],
    stored: float,
    job_id: str | None = "job-1",
) -> dict[str, Any]:
    return {
        "id": artifact_id,
        "derivative_type": dtype,
        "source_document_id": "11111111-1111-1111-1111-111111111111",
        "derivative_generation_job_id": job_id,
        "content_json": content,
        "confidence_score": stored,
    }


class FakeCursor:
    def __init__(self, state: dict[str, Any]):
        self._state = state
        self._rows: list[dict[str, Any]] = []

    def __enter__(self) -> FakeCursor:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def execute(self, sql: str, params: Any = None) -> None:
        self._state["log"].append((sql, params))
        types, last_id, _again, page_size = params
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


@pytest.fixture
def fake_db(monkeypatch: pytest.MonkeyPatch):
    state: dict[str, Any] = {"rows": [], "log": []}
    monkeypatch.setattr(pcw, "get_connection", lambda: FakeConnection(state))
    monkeypatch.setattr(
        pcw.db, "get_document_sections_for_digest", lambda _doc_id: SHORT_SOURCE
    )
    return state


class TestReadOnly:
    def test_the_script_contains_no_write_statement(self) -> None:
        """Structural: this runs against prod, so it must not be able to write."""
        source = Path(pcw.__file__).read_text(encoding="utf-8")
        code = re.sub(r'""".*?"""', "", source, flags=re.DOTALL)
        for forbidden in ("UPDATE ", "INSERT ", "DELETE ", "execute_batch", "commit("):
            assert forbidden not in code, f"write path present: {forbidden}"

    def test_no_apply_flag_exists(self) -> None:
        source = Path(pcw.__file__).read_text(encoding="utf-8")
        code = re.sub(r'""".*?"""', "", source, flags=re.DOTALL)
        assert "--apply" not in code

    def test_run_issues_only_selects(self, fake_db) -> None:
        fake_db["rows"] = [_row("a" * 36, "flashcard", _deck(), 0.5)]

        pcw.main_with_args(["--type", "flashcard"])

        assert fake_db["log"]
        for sql, _params in fake_db["log"]:
            assert sql.strip().startswith("SELECT")


class TestRowLevelProjection:
    def test_projects_stored_against_current_formula(self, fake_db, capsys) -> None:
        fake_db["rows"] = [_row("a" * 36, "flashcard", _deck(), 0.5)]

        exit_code = pcw.main_with_args(["--type", "flashcard"])
        out = capsys.readouterr().out

        assert exit_code == 0
        assert "PROJECTION — no rows were modified." in out
        assert "flashcard" in out

    def test_counts_rows_crossing_the_bar(self, fake_db) -> None:
        projection = pcw.project_row_level("flashcard", None, {})
        assert projection.crossing_up == 0  # no rows

        fake_db["rows"] = [_row("a" * 36, "flashcard", _deck(), 0.5)]
        projection = pcw.project_row_level("flashcard", None, {})

        assert len(projection.stored) == 1
        assert projection.above_bar_before == 0
        assert projection.above_bar_after == 1
        assert projection.crossing_up == 1
        assert projection.crossing_down == 0

    def test_records_the_source_section_count(self, fake_db) -> None:
        """The taper is a function of it, so the report has to show it."""
        fake_db["rows"] = [_row("a" * 36, "flashcard", _deck(), 0.5)]

        projection = pcw.project_row_level("flashcard", None, {})

        assert projection.section_counts == [3]

    def test_rows_without_a_stored_score_are_unusable_not_zero(
        self, fake_db
    ) -> None:
        fake_db["rows"] = [_row("a" * 36, "flashcard", _deck(), None)]  # type: ignore[arg-type]

        projection = pcw.project_row_level("flashcard", None, {})

        assert projection.unusable == 1
        assert projection.stored == []


class TestMcqBatchReconstruction:
    def _batch_rows(self, stored: float, count: int = 5) -> list[dict[str, Any]]:
        return [
            _row(f"{i:036d}", "mcq_question", _question(i), stored)
            for i in range(count)
        ]

    def test_reassembles_a_batch_and_projects_it_once(self, fake_db) -> None:
        # 5 questions over 3 sections, every question cited: legacy coverage
        # 3/3 = 1.0, citation 5/5 = 1.0, ocr 1.0 -> stored 1.0
        fake_db["rows"] = self._batch_rows(1.0)

        projection = pcw.project_mcq_batches(None, {})

        assert projection.unit == "batches"
        assert len(projection.stored) == 1
        assert projection.unreconstructable == 0

    def test_a_batch_whose_reconstruction_fails_is_not_counted(
        self, fake_db
    ) -> None:
        """The gate: never project from a shape you cannot prove you read."""
        fake_db["rows"] = self._batch_rows(0.42)  # not what the batch recomputes to

        projection = pcw.project_mcq_batches(None, {})

        assert projection.stored == []
        assert projection.unreconstructable == 1

    def test_batches_are_grouped_by_generation_job(self, fake_db) -> None:
        rows = [
            _row(f"{i:036d}", "mcq_question", _question(i), 1.0, job_id="job-a")
            for i in range(3)
        ] + [
            _row(f"{i + 10:036d}", "mcq_question", _question(i), 1.0, job_id="job-b")
            for i in range(3)
        ]
        fake_db["rows"] = rows

        projection = pcw.project_mcq_batches(None, {})

        # Two batches, each reconstructed and scored once.
        assert len(projection.stored) == 2

    def test_falls_back_to_source_document_when_job_id_is_null(
        self, fake_db
    ) -> None:
        fake_db["rows"] = [
            _row(f"{i:036d}", "mcq_question", _question(i), 1.0, job_id=None)
            for i in range(5)
        ]

        projection = pcw.project_mcq_batches(None, {})

        assert len(projection.stored) == 1
        assert projection.unusable == 0


class TestExclusions:
    def test_subject_outline_is_excluded_with_a_reason(self) -> None:
        assert "subject_outline" in pcw.EXCLUDED_TYPES
        assert "multiple" in pcw.EXCLUDED_TYPES["subject_outline"].lower()

    def test_exclusions_are_printed(self, fake_db, capsys) -> None:
        fake_db["rows"] = [_row("a" * 36, "flashcard", _deck(), 0.5)]

        pcw.main_with_args(["--type", "flashcard"])

        out = capsys.readouterr().out
        assert "EXCLUDED" in out
        assert "subject_outline" in out
