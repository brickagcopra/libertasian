"""Tests for the read-only essay dangling-citation report."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest

from src.scripts import report_essay_dangling_citations as rep

DOC_A = "11111111-1111-4111-8111-111111111111"
DOC_B = "22222222-2222-4222-8222-222222222222"
SEC_A1 = "aaaaaaaa-0000-4000-8000-000000000001"
SEC_A2 = "aaaaaaaa-0000-4000-8000-000000000002"
SEC_B1 = "bbbbbbbb-0000-4000-8000-000000000001"
FABRICATED = "00000000-dead-4000-8000-000000000bad"

# id -> owning document, for the rows that exist in legal_document_sections
LIVE_SECTIONS = {SEC_A1: DOC_A, SEC_A2: DOC_A, SEC_B1: DOC_B}


def _essay(
    artifact_id: str,
    cited: list[list[str]],
    *,
    document_id: str = DOC_A,
    visibility: str = "private",
    version: str | None = None,
    confidence: float | None = 0.5,
) -> dict[str, Any]:
    return {
        "id": artifact_id,
        "source_document_id": document_id,
        "visibility": visibility,
        "review_status": "draft",
        "confidence_score": confidence,
        "created_at": "2026-07-27T00:00:00Z",
        "prompt_template_version": version,
        "content_json": {
            "modelAnswer": {
                "outlineSections": [
                    {"heading": f"H{i}", "citedSectionIds": ids}
                    for i, ids in enumerate(cited)
                ],
            },
        },
    }


@pytest.fixture
def fake_db(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    state: dict[str, Any] = {"rows": [], "resolve_calls": []}

    def fake_iter(created_after: str | None, split_by_version: bool) -> Any:
        state["last_args"] = (created_after, split_by_version)
        return iter(state["rows"])

    def fake_resolve(section_ids: set[str]) -> dict[str, str]:
        state["resolve_calls"].append(set(section_ids))
        return {k: v for k, v in LIVE_SECTIONS.items() if k in section_ids}

    monkeypatch.setattr(rep, "_iter_essays", fake_iter)
    monkeypatch.setattr(rep, "_resolve", fake_resolve)
    return state


class TestReadOnly:
    def test_no_write_path_exists(self) -> None:
        source = Path(rep.__file__).read_text(encoding="utf-8")
        code = re.sub(r'""".*?"""', "", source, flags=re.DOTALL)
        for forbidden in (
            "UPDATE ",
            "INSERT ",
            "DELETE ",
            "execute_batch",
            "commit(",
            "--apply",
        ):
            assert forbidden not in code, f"write path present: {forbidden}"


class TestClassification:
    def test_a_fabricated_id_is_dangling_not_cross_document(self, fake_db) -> None:
        fake_db["rows"] = [_essay("e1", [[SEC_A1], [FABRICATED]])]

        tallies, _published = rep.collect(None, False)
        t = tallies["all essays"]

        assert t.refs == 2
        assert t.refs_resolving_to_source == 1
        assert t.refs_resolving_to_other_document == 0
        assert t.refs_dangling == 1
        assert t.dangling_ref_rate == 0.5

    def test_another_documents_section_is_not_dangling(self, fake_db) -> None:
        """Real provenance to a different document is a separate category.

        Prod had zero of these, which is what made 'fabricated' the only
        reading available.
        """
        fake_db["rows"] = [_essay("e1", [[SEC_B1]], document_id=DOC_A)]

        tallies, _published = rep.collect(None, False)
        t = tallies["all essays"]

        assert t.refs_resolving_to_other_document == 1
        assert t.refs_dangling == 0

    def test_essays_are_counted_by_whether_any_ref_dangles(self, fake_db) -> None:
        fake_db["rows"] = [
            _essay("e1", [[SEC_A1], [FABRICATED]]),
            _essay("e2", [[SEC_A1], [SEC_A2]]),
            _essay("e3", [[FABRICATED], [FABRICATED]]),
        ]

        tallies, _published = rep.collect(None, False)
        t = tallies["all essays"]

        assert t.essays == 3
        assert t.essays_with_any_ref == 3
        assert t.essays_with_dangling == 2

    def test_essays_citing_nothing_are_excluded_from_the_essay_rate(
        self, fake_db
    ) -> None:
        """An essay with empty lists has no dangling refs and no honest ones.

        Counting it as 'clean' would make the rate improve simply because the
        fix lets the model leave a list empty.
        """
        fake_db["rows"] = [
            _essay("e1", [[], []]),
            _essay("e2", [[FABRICATED]]),
        ]

        tallies, _published = rep.collect(None, False)
        t = tallies["all essays"]

        assert t.essays == 2
        assert t.essays_with_any_ref == 1
        assert t.dangling_essay_rate == 1.0

    def test_citation_mapping_matches_the_scorer(self, fake_db) -> None:
        """Same rule as compute_essay_confidence_score: >= 1 valid id."""
        fake_db["rows"] = [_essay("e1", [[SEC_A1], [FABRICATED], [], [SEC_B1]])]

        tallies, _published = rep.collect(None, False)
        t = tallies["all essays"]

        assert t.outline_sections == 4
        assert t.outline_sections_grounded == 2
        assert t.citation_mapping == 0.5

    def test_unreadable_content_is_reported_not_counted(self, fake_db) -> None:
        row = _essay("e1", [[SEC_A1]])
        row["content_json"] = "{not json"
        fake_db["rows"] = [row]

        tallies, _published = rep.collect(None, False)

        assert tallies["all essays"].unreadable == 1
        assert tallies["all essays"].refs == 0

    def test_non_uuid_stubs_never_reach_the_uuid_cast(self, fake_db) -> None:
        """A malformed literal in ANY(%s::uuid[]) aborts the whole statement."""
        fake_db["rows"] = [_essay("e1", [["1", "bogus", SEC_A1]])]

        tallies, _published = rep.collect(None, False)

        assert fake_db["resolve_calls"] == [{SEC_A1}]
        # They are still refs, and still dangling.
        assert tallies["all essays"].refs == 3
        assert tallies["all essays"].refs_dangling == 2


class TestPublishedList:
    def test_only_public_editorial_rows_are_listed(self, fake_db) -> None:
        fake_db["rows"] = [
            _essay("e1", [[FABRICATED]], visibility="public_editorial"),
            _essay("e2", [[FABRICATED]], visibility="private"),
            _essay("e3", [[SEC_A1]], visibility="public_editorial"),
        ]

        _tallies, published = rep.collect(None, False)

        assert [r["id"] for r in published] == ["e1"]

    def test_the_worst_offenders_come_first(self, fake_db) -> None:
        fake_db["rows"] = [
            _essay("e1", [[FABRICATED]], visibility="public_editorial"),
            _essay(
                "e2",
                [[FABRICATED, FABRICATED], [FABRICATED]],
                visibility="public_editorial",
            ),
        ]

        _tallies, published = rep.collect(None, False)

        assert [r["id"] for r in published] == ["e2", "e1"]
        assert published[0]["dangling"] == 3

    def test_the_table_is_markdown_for_a_pr_body(self, fake_db, capsys) -> None:
        fake_db["rows"] = [
            _essay("e1", [[FABRICATED]], visibility="public_editorial")
        ]

        rep.main_with_args(["--published"])

        out = capsys.readouterr().out
        assert "| artifact_id | source_document_id |" in out
        assert "| `e1` |" in out

    def test_the_list_is_withheld_unless_asked_for(self, fake_db, capsys) -> None:
        fake_db["rows"] = [
            _essay("e1", [[FABRICATED]], visibility="public_editorial")
        ]

        rep.main_with_args([])

        out = capsys.readouterr().out
        assert "essays with >= 1 dangling ref: 1" in out
        assert "| `e1` |" not in out


class TestVersionSplit:
    def test_buckets_are_the_prompt_versions(self, fake_db) -> None:
        fake_db["rows"] = [
            _essay("e1", [[FABRICATED]], version="essay_generation.v1"),
            _essay("e2", [[SEC_A1]], version="essay_generation.v2"),
            _essay("e3", [[SEC_A2]], version="essay_generation.v2"),
        ]

        tallies, _published = rep.collect(None, True)

        assert set(tallies) == {"essay_generation.v1", "essay_generation.v2"}
        assert tallies["essay_generation.v2"].refs_dangling == 0
        assert tallies["essay_generation.v1"].refs_dangling == 1

    def test_rows_without_a_model_run_are_their_own_bucket(self, fake_db) -> None:
        """Not folded into either, or the comparison quietly gains rows."""
        fake_db["rows"] = [_essay("e1", [[FABRICATED]], version=None)]

        tallies, _published = rep.collect(None, True)

        assert "unknown (no model_run)" in tallies

    def test_a_clean_fixed_bucket_is_stated_plainly(self, fake_db, capsys) -> None:
        fake_db["rows"] = [
            _essay("e1", [[SEC_A1]], version=rep.FIXED_PROMPT_VERSION)
        ]

        rep.main_with_args(["--split-by-version"])

        out = capsys.readouterr().out
        assert f"{rep.FIXED_PROMPT_VERSION}: 1 refs across 1 essays, none dangling" in out

    def test_a_dirty_fixed_bucket_says_what_to_check(self, fake_db, capsys) -> None:
        fake_db["rows"] = [
            _essay("e1", [[FABRICATED]], version=rep.FIXED_PROMPT_VERSION)
        ]

        rep.main_with_args(["--split-by-version"])

        out = capsys.readouterr().out
        assert "still dangling" in out
        assert "predates the deploy" in out


class TestArgs:
    def test_created_after_is_passed_through(self, fake_db) -> None:
        rep.main_with_args(["--created-after", "2026-07-28"])

        assert fake_db["last_args"] == ("2026-07-28", False)


class TestUuidShapeFilter:
    @pytest.mark.parametrize(
        "value",
        [SEC_A1, FABRICATED, "7C9E6679-7425-40DE-944B-E07FC1F90AE7"],
    )
    def test_accepts_uuids(self, value: str) -> None:
        assert rep._looks_like_uuid(value)

    @pytest.mark.parametrize(
        "value",
        ["", "1", "bogus", "section-uuid-1", SEC_A1[:-1], SEC_A1 + "0", SEC_A1.replace("-", "")],
    )
    def test_rejects_everything_else(self, value: str) -> None:
        assert not rep._looks_like_uuid(value)
