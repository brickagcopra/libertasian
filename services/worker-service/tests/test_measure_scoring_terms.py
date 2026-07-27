"""Tests for the read-only scoring-term measurement script."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest

from src.scripts import measure_scoring_terms as mst

SECTIONS = [{"id": f"sec-{i:03d}", "plain_text": f"Section {i}."} for i in range(3)]


def _row(artifact_id: str, dtype: str, content: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": artifact_id,
        "derivative_type": dtype,
        "source_document_id": "11111111-1111-1111-1111-111111111111",
        "derivative_generation_job_id": "job-1",
        "content_json": content,
        "confidence_score": 0.5,
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
    monkeypatch.setattr(mst, "get_connection", lambda: FakeConnection(state))
    monkeypatch.setattr(
        mst.db, "get_document_sections_for_digest", lambda _doc_id: SECTIONS
    )
    return state


class TestReadOnly:
    def test_no_write_path_exists(self) -> None:
        source = Path(mst.__file__).read_text(encoding="utf-8")
        code = re.sub(r'""".*?"""', "", source, flags=re.DOTALL)
        for forbidden in ("UPDATE ", "INSERT ", "DELETE ", "execute_batch", "commit("):
            assert forbidden not in code, f"write path present: {forbidden}"


class TestEssayPresenceVsValidated:
    """The finding this script exists to quantify."""

    def _essay(self, cited: list[list[str]]) -> dict[str, Any]:
        return {
            "modelAnswer": {
                "outlineSections": [
                    {"heading": f"H{i}", "citedSectionIds": ids}
                    for i, ids in enumerate(cited)
                ]
            }
        }

    def test_hallucinated_ids_score_as_fully_cited(self, fake_db) -> None:
        """Every section cites something; none of it exists in the source."""
        fake_db["rows"] = [
            _row("a" * 36, "essay_prompt", self._essay([["nope-1"], ["nope-2"]]))
        ]

        stats = mst.measure("essay_prompt", None, {})

        assert stats.as_scored == [1.0]
        assert stats.validated == [0.0]
        assert stats.inflated == 1

    def test_real_ids_agree_on_both_measures(self, fake_db) -> None:
        fake_db["rows"] = [
            _row("a" * 36, "essay_prompt", self._essay([["sec-000"], ["sec-001"]]))
        ]

        stats = mst.measure("essay_prompt", None, {})

        assert stats.as_scored == [1.0]
        assert stats.validated == [1.0]
        assert stats.inflated == 0

    def test_empty_citation_lists_score_zero(self, fake_db) -> None:
        fake_db["rows"] = [_row("a" * 36, "essay_prompt", self._essay([[], []]))]

        stats = mst.measure("essay_prompt", None, {})

        assert stats.as_scored == [0.0]


class TestValidatedTypesCannotInflate:
    def test_flashcard_hallucinated_ids_score_zero_both_ways(self, fake_db) -> None:
        content = {
            "cards": [
                {"front": "Q", "back": "A", "supportingSectionIds": ["nope"]},
            ]
        }
        fake_db["rows"] = [_row("a" * 36, "flashcard", content)]

        stats = mst.measure("flashcard", None, {})

        assert stats.as_scored == [0.0]
        assert stats.validated == [0.0]
        assert stats.inflated == 0

    def test_doctrine_uses_the_single_snake_case_key(self, fake_db) -> None:
        content = {
            "doctrines": [
                {"text": "d1", "source_section_id": "sec-000"},
                {"text": "d2", "source_section_id": "nope"},
            ]
        }
        fake_db["rows"] = [_row("a" * 36, "doctrine_extract", content)]

        stats = mst.measure("doctrine_extract", None, {})

        assert stats.as_scored == [0.5]
        assert stats.validated == [0.5]


class TestSelfCheck:
    """The script must not report statistics it cannot reconcile."""

    def test_rows_it_cannot_reconcile_are_excluded_not_counted(
        self, fake_db, monkeypatch
    ) -> None:
        content = {
            "cards": [{"front": "Q", "back": "A", "supportingSectionIds": ["sec-000"]}]
        }
        fake_db["rows"] = [_row("a" * 36, "flashcard", content)]
        # Force disagreement between the script's reading and the scorer.
        monkeypatch.setitem(mst.SCORERS, "flashcard", lambda **_kw: 0.123)

        stats = mst.measure("flashcard", None, {})

        assert stats.self_check_failed == 1
        assert stats.as_scored == []

    def test_agreeing_rows_are_kept(self, fake_db) -> None:
        content = {
            "cards": [{"front": "Q", "back": "A", "supportingSectionIds": ["sec-000"]}]
        }
        fake_db["rows"] = [_row("a" * 36, "flashcard", content)]

        stats = mst.measure("flashcard", None, {})

        assert stats.self_check_failed == 0
        assert len(stats.as_scored) == 1


class TestMcqIsMeasuredPerBatch:
    def test_questions_are_grouped_into_one_batch(self, fake_db) -> None:
        fake_db["rows"] = [
            _row(
                f"{i:036d}",
                "mcq_question",
                {"questionStem": f"Q{i}", "supportingSectionIds": ["sec-000"]},
            )
            for i in range(5)
        ]

        stats = mst.measure_mcq_batches(None, {})

        assert stats.unit == "batches"
        assert len(stats.as_scored) == 1
        assert stats.items == [5]


class TestReport:
    def test_states_that_ocr_is_constant(self, fake_db, capsys) -> None:
        fake_db["rows"] = [
            _row(
                "a" * 36,
                "flashcard",
                {"cards": [{"front": "Q", "back": "A", "supportingSectionIds": ["sec-000"]}]},
            )
        ]

        mst.main_with_args(["--type", "flashcard"])

        out = capsys.readouterr().out
        assert "ocr_quality: CONSTANT 1.0" in out
        assert "EXCLUDED" in out
        assert "subject_outline" in out
