"""Tests for the paired v2-vs-v3 prompt pilot.

Two things make the pilot's numbers mean anything, and both are tested here:

* **One retrieval per question.** The breadth denominator is
  ``min(3, distinct documents retrieved)``, so two retrievals of the same
  question against a moving index can hand the two templates different
  denominators and manufacture a difference the prompt did not cause.
* **The judge is aggregated honestly.** A failed or unparseable judge reply
  becomes ``unjudged``, never a default verdict — defaulting to ``supported``
  would flatter whichever template cited more, which is the exact confound the
  audit exists to catch.

The read-only guarantee is covered in ``test_score_bar_exam_answers_dryrun.py``,
which greps both scripts with one list of forbidden verbs.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

from src.scripts import pilot_bar_exam_prompt_versions as pilot

SEC_A = "aaaaaaaa-0000-4000-8000-000000000001"
SEC_B = "bbbbbbbb-0000-4000-8000-000000000001"
DOC_A = "11111111-1111-4111-8111-111111111111"
DOC_B = "22222222-2222-4222-8222-222222222222"
FABRICATED = "00000000-dead-4000-8000-000000000bad"

QUESTION: dict[str, Any] = {
    "id": "q-1",
    "question_text": "Discuss the elements of estafa.",
    "sitting_id": "s-1",
    "sitting_year": 2018,
    "subject_study_code": "criminal_law",
}

PASSAGES = [
    {
        "id": "p-1",
        "section_id": SEC_A,
        "document_id": DOC_A,
        "title": "Revised Penal Code, Art. 315",
        "text": "Estafa is committed by means of deceit.",
        "score": 400.0,
    },
    {
        "id": "p-2",
        "section_id": SEC_B,
        "document_id": DOC_B,
        "title": "People v. Balasa",
        "text": "The elements were applied to a pyramid scheme.",
        "score": 300.0,
    },
]


def _answer(cited: list[str]) -> dict[str, Any]:
    return {
        "answer": "Yes.",
        "law": "RPC Art. 315.",
        "analysis": "Deceit and damage are present.",
        "conclusion": "Estafa lies.",
        "citedSectionIds": cited,
    }


def _response(content: Any, tokens_in: int = 100, tokens_out: int = 50):
    return {
        "content": content,
        "model_name": "gpt-4o-mini",
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    }


class TestPairing:
    @patch("src.scripts.pilot_bar_exam_prompt_versions.db")
    @patch("src.scripts.pilot_bar_exam_prompt_versions.rag_client")
    def test_one_retrieval_serves_both_templates(
        self,
        mock_rag: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        mock_db.get_bar_exam_question_with_context.return_value = QUESTION
        mock_db.resolve_section_ids.return_value = {SEC_A: DOC_A, SEC_B: DOC_B}
        mock_rag.retrieve_passages.return_value = PASSAGES
        mock_rag.generate_completion.return_value = _response(_answer([SEC_A]))

        outcomes = pilot.run_question("q-1", audit=False)

        # THE test: retrieval happens once, and both generations were handed
        # the identical passage list object.
        mock_rag.retrieve_passages.assert_called_once()
        assert [o.version for o in outcomes] == ["v2", "v3"]
        assert all(o.available_documents == 2 for o in outcomes)
        assert all(o.denominator == 2 for o in outcomes)

    @patch("src.scripts.pilot_bar_exam_prompt_versions.db")
    @patch("src.scripts.pilot_bar_exam_prompt_versions.rag_client")
    def test_each_template_gets_its_own_prompt(
        self,
        mock_rag: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        mock_db.get_bar_exam_question_with_context.return_value = QUESTION
        mock_db.resolve_section_ids.return_value = {SEC_A: DOC_A}
        mock_rag.retrieve_passages.return_value = PASSAGES
        mock_rag.generate_completion.return_value = _response(_answer([SEC_A]))

        pilot.run_question("q-1", audit=False)

        prompts = [
            call.kwargs["user_prompt"]
            for call in mock_rag.generate_completion.call_args_list
        ]
        assert len(prompts) == 2
        assert "AUTHORITY 1" not in prompts[0]
        assert "AUTHORITY 1 — Revised Penal Code, Art. 315" in prompts[1]

    @patch("src.scripts.pilot_bar_exam_prompt_versions.db")
    @patch("src.scripts.pilot_bar_exam_prompt_versions.rag_client")
    def test_no_retrieval_skips_the_pair_rather_than_comparing_nothing(
        self,
        mock_rag: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        mock_db.get_bar_exam_question_with_context.return_value = QUESTION
        mock_rag.retrieve_passages.return_value = []

        outcomes = pilot.run_question("q-1", audit=False)

        assert [o.status for o in outcomes] == ["no_retrieval", "no_retrieval"]
        mock_rag.generate_completion.assert_not_called()

    @patch("src.scripts.pilot_bar_exam_prompt_versions.db")
    @patch("src.scripts.pilot_bar_exam_prompt_versions.rag_client")
    def test_missing_question_produces_no_rows(
        self,
        mock_rag: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        mock_db.get_bar_exam_question_with_context.return_value = None
        assert pilot.run_question("q-missing", audit=False) == []
        mock_rag.retrieve_passages.assert_not_called()


class TestFilteringMatchesProduction:
    @patch("src.scripts.pilot_bar_exam_prompt_versions.db")
    @patch("src.scripts.pilot_bar_exam_prompt_versions.rag_client")
    def test_fabricated_id_is_dropped_and_counted(
        self,
        mock_rag: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        mock_db.resolve_section_ids.return_value = {SEC_A: DOC_A}
        mock_rag.generate_completion.return_value = _response(
            _answer([SEC_A, FABRICATED]),
        )

        outcome = pilot.run_one_template(QUESTION, PASSAGES, "v3", audit=False)

        assert outcome.emitted == 2
        assert outcome.valid == 1
        assert outcome.fabricated == 1
        assert outcome.cited_documents == 1
        # 0.5 resolution + 0.5 * (1 of 2 documents) = 0.5
        assert outcome.score == 0.5
        assert outcome.passes is False

    @patch("src.scripts.pilot_bar_exam_prompt_versions.db")
    @patch("src.scripts.pilot_bar_exam_prompt_versions.rag_client")
    def test_citing_both_authorities_passes_the_bar(
        self,
        mock_rag: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        mock_db.resolve_section_ids.return_value = {SEC_A: DOC_A, SEC_B: DOC_B}
        mock_rag.generate_completion.return_value = _response(
            _answer([SEC_A, SEC_B]),
        )

        outcome = pilot.run_one_template(QUESTION, PASSAGES, "v3", audit=False)

        assert outcome.score == 1.0
        assert outcome.passes is True

    @patch("src.scripts.pilot_bar_exam_prompt_versions.db")
    @patch("src.scripts.pilot_bar_exam_prompt_versions.rag_client")
    def test_abstention_and_malformed_output_are_recorded_not_scored(
        self,
        mock_rag: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        mock_rag.generate_completion.return_value = _response(
            {"abstain": True, "abstainReason": "needs the appended Code"},
        )
        abstained = pilot.run_one_template(QUESTION, PASSAGES, "v2", audit=False)
        assert abstained.status == "llm_abstained"
        assert abstained.score is None

        mock_rag.generate_completion.return_value = _response("not json {")
        broken = pilot.run_one_template(QUESTION, PASSAGES, "v2", audit=False)
        assert broken.status == "llm_invalid_json"

        mock_rag.generate_completion.return_value = _response({"answer": "only"})
        partial = pilot.run_one_template(QUESTION, PASSAGES, "v2", audit=False)
        assert partial.status == "llm_malformed"


class TestRelevanceAudit:
    @patch("src.scripts.pilot_bar_exam_prompt_versions.rag_client")
    def test_judge_returns_the_verdict_and_its_tokens(
        self,
        mock_rag: MagicMock,
    ) -> None:
        mock_rag.generate_completion.return_value = _response(
            {"verdict": "supported", "reason": "states the rule relied on"},
            tokens_in=80,
            tokens_out=20,
        )

        verdict, tokens_in, tokens_out, model = pilot.judge_citation(
            "Estafa is committed by means of deceit.",
            "RPC Art. 315.",
            "Deceit and damage are present.",
        )

        assert verdict == "supported"
        assert (tokens_in, tokens_out) == (80, 20)
        assert model == "gpt-4o-mini"
        user_prompt = mock_rag.generate_completion.call_args.kwargs["user_prompt"]
        assert "ANSWER LAW" in user_prompt
        assert "ANSWER ANALYSIS" in user_prompt
        assert mock_rag.generate_completion.call_args.kwargs["temperature"] == 0
        assert mock_rag.generate_completion.call_args.kwargs["scope"] == (
            "bar_exam_answer"
        )

    @patch("src.scripts.pilot_bar_exam_prompt_versions.rag_client")
    def test_unknown_verdict_is_unjudged_not_a_default(
        self,
        mock_rag: MagicMock,
    ) -> None:
        mock_rag.generate_completion.return_value = _response(
            {"verdict": "probably fine"},
        )
        assert pilot.judge_citation("p", "l", "a")[0] == "unjudged"

        mock_rag.generate_completion.return_value = _response("not json {")
        assert pilot.judge_citation("p", "l", "a")[0] == "unjudged"

    @patch("src.scripts.pilot_bar_exam_prompt_versions.db")
    @patch("src.scripts.pilot_bar_exam_prompt_versions.rag_client")
    def test_one_judge_call_per_surviving_citation_only(
        self,
        mock_rag: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        """The fabricated id was stripped, so it is not audited."""
        mock_db.resolve_section_ids.return_value = {SEC_A: DOC_A, SEC_B: DOC_B}
        mock_rag.generate_completion.side_effect = [
            _response(_answer([SEC_A, SEC_B, FABRICATED])),
            _response({"verdict": "supported", "reason": "r"}),
            _response({"verdict": "tangential", "reason": "r"}),
        ]

        outcome = pilot.run_one_template(QUESTION, PASSAGES, "v3", audit=True)

        assert [c["verdict"] for c in outcome.citations] == [
            "supported",
            "tangential",
        ]
        # 1 generation + 2 judges, not 3 judges.
        assert mock_rag.generate_completion.call_count == 3

    @patch("src.scripts.pilot_bar_exam_prompt_versions.db")
    @patch("src.scripts.pilot_bar_exam_prompt_versions.rag_client")
    def test_judge_tokens_are_added_to_the_metered_spend(
        self,
        mock_rag: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        mock_db.resolve_section_ids.return_value = {SEC_A: DOC_A}
        mock_rag.generate_completion.side_effect = [
            _response(_answer([SEC_A]), tokens_in=1000, tokens_out=500),
            _response({"verdict": "supported"}, tokens_in=200, tokens_out=10),
        ]

        outcome = pilot.run_one_template(QUESTION, PASSAGES, "v2", audit=True)

        assert outcome.tokens_in == 1200
        assert outcome.tokens_out == 510
        assert pilot.total_cost([outcome]) > 0

    @patch("src.scripts.pilot_bar_exam_prompt_versions.db")
    @patch("src.scripts.pilot_bar_exam_prompt_versions.rag_client")
    def test_a_failing_judge_does_not_lose_the_answer(
        self,
        mock_rag: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        mock_db.resolve_section_ids.return_value = {SEC_A: DOC_A}
        mock_rag.generate_completion.side_effect = [
            _response(_answer([SEC_A])),
            RuntimeError("rag down"),
        ]

        outcome = pilot.run_one_template(QUESTION, PASSAGES, "v2", audit=True)

        assert outcome.status == "generated"
        assert outcome.citations == [
            {"section_id": SEC_A, "verdict": "unjudged"},
        ]


class TestReporting:
    def _outcome(self, version: str, **kwargs) -> pilot.Outcome:
        defaults: dict[str, Any] = {
            "score": 1.0,
            "emitted": 2,
            "valid": 2,
            "fabricated": 0,
            "cited_documents": 2,
            "available_documents": 3,
            "denominator": 3,
            "citations": [],
            "tokens_in": 10,
            "tokens_out": 5,
            "model_name": "gpt-4o-mini",
        }
        defaults.update(kwargs)
        return pilot.Outcome(
            kwargs.pop("question_id", "q-1"),
            kwargs.pop("subject", "criminal_law"),
            version,
            "generated",
            **{k: v for k, v in defaults.items() if k not in ("question_id", "subject")},
        )

    def test_verdict_shares_are_reported_per_version(self):
        outcomes = [
            self._outcome(
                "v3",
                citations=[
                    {"section_id": SEC_A, "verdict": "supported"},
                    {"section_id": SEC_B, "verdict": "tangential"},
                ],
            ),
        ]
        report = pilot.summarize_version(outcomes, "v3")
        assert "citations audited  2" in report
        assert "supported" in report
        assert "tangential" in report

    def test_paired_block_counts_crossings_in_both_directions(self):
        up_v2 = pilot.Outcome("q-up", "civil_law", "v2", "generated", score=0.667)
        up_v3 = pilot.Outcome("q-up", "civil_law", "v3", "generated", score=0.833)
        down_v2 = pilot.Outcome("q-dn", "civil_law", "v2", "generated", score=0.833)
        down_v3 = pilot.Outcome("q-dn", "civil_law", "v3", "generated", score=0.5)

        report = pilot.summarize_pairs([up_v2, up_v3, down_v2, down_v3])

        assert "crossed UP   (v3 only)   1" in report
        assert "crossed DOWN (v2 only)   1" in report
        assert "UP   q-up  0.667 -> 0.833" in report

    def test_ungenerated_rows_are_excluded_from_the_pairing(self):
        left = pilot.Outcome("q-1", "civil_law", "v2", "llm_abstained")
        right = pilot.Outcome("q-1", "civil_law", "v3", "generated", score=1.0)
        report = pilot.summarize_pairs([left, right])
        assert "crossed UP   (v3 only)   0" in report
