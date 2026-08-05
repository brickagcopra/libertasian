"""Tests for the read-only bar exam scoring dry run.

The most important test in this file is the one that greps the source for
write verbs. Everything else checks that the report says what it means —
particularly that "retrieval succeeded" is read off the prompt version and not
inferred from the score, since an answer that retrieved eight passages and
cited none of them is a different failure from a retrieval miss.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest

from src.scripts import score_bar_exam_answers_dryrun as dry

SEC_A = "aaaaaaaa-0000-4000-8000-000000000001"
SEC_B = "bbbbbbbb-0000-4000-8000-000000000001"
DOC_A = "11111111-1111-4111-8111-111111111111"
DOC_B = "22222222-2222-4222-8222-222222222222"
FABRICATED = "00000000-dead-4000-8000-000000000bad"

RESOLVED = {SEC_A: DOC_A, SEC_B: DOC_B}


def _row(
    answer_id: str = "ans-1",
    *,
    cited: list[str] | None = None,
    version: str | None = "bar_exam_alac.v2",
    stored: float | None = None,
    subject: str = "criminal_law",
    review_status: str = "pending",
    denominator: int | None = None,
    available_documents: int | None = None,
) -> dict[str, Any]:
    structured: dict[str, Any] = {
        "answer": "A",
        "law": "L",
        "analysis": "AN",
        "conclusion": "C",
        "citedSectionIds": cited if cited is not None else [],
    }
    if denominator is not None:
        structured["grounding"] = {
            "emittedIds": len(cited or []),
            "validIds": len(cited or []),
            "fabricatedIds": 0,
            "citedDocuments": len(cited or []),
            "availableDocuments": (
                available_documents if available_documents is not None else denominator
            ),
            "breadthDenominator": denominator,
        }
    return {
        "id": answer_id,
        "bar_exam_question_id": f"q-{answer_id}",
        "stored_confidence": stored,
        "review_status": review_status,
        "structured_answer_json": structured,
        "prompt_template_version": version,
        "subject_study_code": subject,
    }


class TestCannotWrite:
    def test_source_contains_no_write_path(self):
        source = Path(dry.__file__).read_text(encoding="utf-8")
        code = re.sub(r'""".*?"""', "", source, flags=re.DOTALL)
        for forbidden in (
            "UPDATE ",
            "INSERT ",
            "DELETE ",
            "commit(",
            "--apply",
        ):
            assert forbidden not in code, f"write path present: {forbidden}"


class TestScoreRow:
    def test_fabricated_id_lowers_the_recomputed_score(self):
        row = dry.score_row(_row(cited=[SEC_A, FABRICATED]), RESOLVED)
        assert row.recomputed.citation_resolution == 0.5
        assert row.recomputed.fabricated_id_count == 1

    def test_priors_only_row_scores_zero(self):
        row = dry.score_row(_row(cited=[], version="bar_exam_alac.v1"), RESOLVED)
        assert row.recomputed.score == 0.0
        assert row.grounded is False

    def test_stored_confidence_wins_over_recomputation(self):
        """The stored score saw the passage set; recomputation cannot."""
        row = dry.score_row(_row(cited=[SEC_A], stored=0.83), RESOLVED)
        assert row.score == pytest.approx(0.83)
        assert row.recomputed.score != pytest.approx(0.83)

    def test_recomputation_is_used_when_nothing_was_stored(self):
        row = dry.score_row(_row(cited=[SEC_A, SEC_B], stored=None), RESOLVED)
        assert row.score == row.recomputed.score

    def test_divergence_is_flagged(self):
        row = dry.score_row(_row(cited=[SEC_A], stored=0.83), RESOLVED)
        assert row.diverges is True

    def test_no_divergence_when_they_agree(self):
        row = dry.score_row(_row(cited=[SEC_A, SEC_B], stored=1.0), RESOLVED)
        assert row.diverges is False

    def test_string_json_is_parsed(self):
        raw = _row(cited=[SEC_A])
        raw["structured_answer_json"] = f'{{"citedSectionIds": ["{SEC_A}"]}}'
        row = dry.score_row(raw, RESOLVED)
        assert row.recomputed.valid_id_count == 1

    def test_unparseable_json_degrades_to_zero_rather_than_raising(self):
        raw = _row()
        raw["structured_answer_json"] = "{not json"
        row = dry.score_row(raw, RESOLVED)
        assert row.recomputed.score == 0.0

    def test_missing_subject_becomes_unknown(self):
        raw = _row()
        raw["subject_study_code"] = None
        assert dry.score_row(raw, RESOLVED).subject == "unknown"


class TestRetrievalSucceededIsReadOffTheVersion:
    def test_v2_row_counts_as_retrieval_succeeded_even_scoring_zero(self):
        row = dry.score_row(_row(cited=[], version="bar_exam_alac.v2"), RESOLVED)
        assert row.grounded is True
        assert row.score == 0.0

    def test_v1_row_never_counts_as_retrieval_succeeded(self):
        row = dry.score_row(
            _row(cited=[SEC_A, SEC_B], version="bar_exam_alac.v1"), RESOLVED
        )
        assert row.grounded is False

    def test_null_version_is_not_grounded(self):
        assert dry.score_row(_row(version=None), RESOLVED).grounded is False


class TestSummarize:
    def test_empty_input_says_so(self):
        assert "(no rows)" in dry.summarize([], "LABEL")

    def test_counts_and_bar_are_reported(self):
        rows = [
            dry.score_row(_row("a", cited=[SEC_A, SEC_B], stored=1.0), RESOLVED),
            dry.score_row(_row("b", cited=[], stored=0.0), RESOLVED),
        ]
        out = dry.summarize(rows, "LABEL")
        assert "rows:                 2" in out
        assert "1 / 2" in out
        assert "50.0%" in out

    def test_per_subject_breakdown_is_present(self):
        rows = [
            dry.score_row(_row("a", cited=[SEC_A, SEC_B], stored=1.0), RESOLVED),
            dry.score_row(
                _row("b", cited=[], stored=0.0, subject="civil_law"), RESOLVED
            ),
        ]
        out = dry.summarize(rows, "LABEL")
        assert "criminal_law" in out
        assert "civil_law" in out

    def test_term_distribution_warns_about_constant_terms(self):
        rows = [dry.score_row(_row(cited=[SEC_A], stored=0.5), RESOLVED)]
        out = dry.summarize(rows, "LABEL")
        assert "discriminates nothing" in out

    def test_divergence_is_surfaced_in_the_report(self):
        rows = [dry.score_row(_row(cited=[SEC_A], stored=0.83), RESOLVED)]
        assert "stored != recomputed" in dry.summarize(rows, "LABEL")

    def test_unscored_rows_are_counted_separately(self):
        rows = [dry.score_row(_row(cited=[], version="bar_exam_alac.v1"), RESOLVED)]
        assert "unscored (NULL):      1" in dry.summarize(rows, "LABEL")


class TestDenominatorBreakout:
    """The adaptive bar has to be visible, not blended away.

    Validated on prod 2026-08-05 over 64 questions: denominator 3 for 66% of
    them, 2 for 31%, 1 for 3%. At denominator 2 a single clean citation scores
    0.75 and passes; at denominator 3 the same answer scores 0.667 and fails.
    A single aggregate rate would hide that entirely.
    """

    def test_denominator_is_read_from_the_grounding_block(self):
        row = dry.score_row(_row(cited=[SEC_A], denominator=2), RESOLVED)
        assert row.denominator == 2

    def test_row_without_a_grounding_block_has_an_unknown_denominator(self):
        """Pre-#357 rows are not guessed into a bucket."""
        row = dry.score_row(_row(cited=[SEC_A]), RESOLVED)
        assert row.denominator is None

    def test_malformed_grounding_block_degrades_to_unknown(self):
        raw = _row(cited=[SEC_A])
        raw["structured_answer_json"]["grounding"] = "not a dict"
        assert dry.score_row(raw, RESOLVED).denominator is None

    def test_report_breaks_the_distribution_out_by_denominator(self):
        rows = [
            dry.score_row(_row("a", cited=[SEC_A], stored=0.75, denominator=2), RESOLVED),
            dry.score_row(
                _row("b", cited=[SEC_A], stored=0.667, denominator=3), RESOLVED
            ),
        ]
        out = dry.summarize(rows, "LABEL")
        assert "BY BREADTH DENOMINATOR" in out
        assert "denominator 2   1/1" in out
        assert "denominator 3   0/1" in out

    def test_identical_answers_land_in_different_buckets(self):
        """One clean citation: passes at denominator 2, fails at 3."""
        at_two = dry.score_row(
            _row("a", cited=[SEC_A], stored=0.75, denominator=2), RESOLVED
        )
        at_three = dry.score_row(
            _row("b", cited=[SEC_A], stored=0.667, denominator=3), RESOLVED
        )
        assert at_two.passes is True
        assert at_three.passes is False

    def test_unknown_denominator_bucket_is_labelled_not_silently_dropped(self):
        rows = [dry.score_row(_row(cited=[], version="bar_exam_alac.v1"), RESOLVED)]
        out = dry.summarize(rows, "LABEL")
        assert "denominator ?" in out
        assert "pre-#357" in out

    def test_every_row_appears_in_exactly_one_denominator_bucket(self):
        rows = [
            dry.score_row(_row("a", cited=[SEC_A], denominator=1), RESOLVED),
            dry.score_row(_row("b", cited=[SEC_A], denominator=2), RESOLVED),
            dry.score_row(_row("c", cited=[SEC_A], denominator=3), RESOLVED),
            dry.score_row(_row("d", cited=[SEC_A]), RESOLVED),
        ]
        out = dry.summarize(rows, "LABEL")
        for bucket in ("denominator 1", "denominator 2", "denominator 3", "denominator ?"):
            assert f"{bucket}   " in out

    def test_per_subject_reports_mean_denominator(self):
        """Retrieval breadth varies by subject and the report must say so."""
        rows = [
            dry.score_row(
                _row("a", cited=[SEC_A], denominator=3, subject="criminal_law"),
                RESOLVED,
            ),
            dry.score_row(
                _row("b", cited=[SEC_A], denominator=2, subject="legal_ethics"),
                RESOLVED,
            ),
        ]
        out = dry.summarize(rows, "LABEL")
        assert "mean denominator 3.0" in out
        assert "mean denominator 2.0" in out

    def test_per_subject_by_denominator_cross_tab_is_present(self):
        rows = [
            dry.score_row(
                _row("a", cited=[SEC_A], stored=1.0, denominator=3, subject="civil_law"),
                RESOLVED,
            ),
            dry.score_row(
                _row("b", cited=[SEC_A], stored=0.5, denominator=2, subject="civil_law"),
                RESOLVED,
            ),
        ]
        out = dry.summarize(rows, "LABEL")
        assert "per-subject x denominator" in out
        assert "d2 0/1" in out
        assert "d3 1/1" in out


class TestStoredCitedIds:
    def test_non_list_yields_empty(self):
        assert dry._stored_cited_ids({"citedSectionIds": "nope"}) == []

    def test_duplicates_collapse(self):
        assert dry._stored_cited_ids({"citedSectionIds": [SEC_A, SEC_A]}) == [SEC_A]

    def test_non_dict_yields_empty(self):
        assert dry._stored_cited_ids(None) == []
        assert dry._stored_cited_ids(42) == []


class TestUuidGuard:
    def test_junk_is_not_sent_to_postgres(self):
        """A malformed id would abort the statement and take the batch with it."""
        assert dry._looks_like_uuid("not-a-uuid") is False
        assert dry._looks_like_uuid(SEC_A) is True
        assert dry._looks_like_uuid(None) is False
