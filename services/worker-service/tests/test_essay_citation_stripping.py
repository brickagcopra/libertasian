"""Fabricated ``citedSectionIds`` must not reach storage or the score.

Measured on prod 2026-07-27: of 67,515 citation refs across 14,029 essays,
39,992 (59.2%) resolved to no row in ``legal_document_sections``, and none
resolved to a section of a different document — invented, not mis-attributed.

Two things let that happen, and both are covered here:

1. ``essay_generation_tasks`` passed the LLM output through to ``contentJson``
   and ``modelAnswerJson`` unfiltered. The flashcard and MCQ tasks have always
   filtered theirs (``_build_derivative_cards``,
   ``_build_passing_question_entries``), which is why those types do not carry
   dangling IDs — not, as it first appears, because their prompts supply the
   candidate IDs and the essay prompt did not. All four prompts have always
   enumerated the section IDs in their passage headers.
2. ``compute_essay_confidence_score`` counted ``bool(citedSectionIds)``, so an
   invented ID scored exactly like a real one. That is covered in
   ``test_essay_confidence_score.py``.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from src.prompts.essay_generation_v1 import (
    ESSAY_GENERATION_SYSTEM_PROMPT,
    PROMPT_TEMPLATE_VERSION,
    build_section_ids_text,
    build_user_prompt,
)
from src.tasks.essay_generation_tasks import (
    CONFIDENCE_THRESHOLD,
    _strip_unknown_section_ids,
    generate_essay_prompt,
)
from tests.test_essay_generation_tasks import (
    FAKE_DOC,
    FAKE_LLM_CONTENT,
    FAKE_RAG_RESPONSE,
    FAKE_SECTIONS,
)

# Real section IDs are uuid columns, so the fabrications look like this too.
# A "sec-001"-shaped fixture would make the filter look like a format check
# when what it enforces is membership of the retrieved set.
REAL_SECTION_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
OTHER_REAL_SECTION_ID = "b1f4e3c2-2a11-4f6d-9c33-5e8d0a2b7c41"
FABRICATED_SECTION_ID = "00000000-dead-4000-8000-000000000bad"

UUID_SECTIONS: list[dict[str, Any]] = [
    {**FAKE_SECTIONS[0], "id": REAL_SECTION_ID},
    {**FAKE_SECTIONS[1], "id": OTHER_REAL_SECTION_ID},
]

ALAC = ["Answer", "Law", "Application", "Conclusion"]


def _outline(cited: list[list[Any]]) -> dict[str, Any]:
    return {
        "modelAnswer": {
            "outlineSections": [
                {"heading": f"H{i}", "paragraphs": ["p"], "citedSectionIds": ids}
                for i, ids in enumerate(cited)
            ],
        },
    }


class TestStripUnknownSectionIds:
    """The filter itself, isolated from the task."""

    def test_fabricated_ids_are_dropped(self) -> None:
        cleaned, kept, dropped = _strip_unknown_section_ids(
            _outline([[REAL_SECTION_ID, FABRICATED_SECTION_ID]]),
            {REAL_SECTION_ID, OTHER_REAL_SECTION_ID},
        )
        outline = cleaned["modelAnswer"]["outlineSections"]
        assert outline[0]["citedSectionIds"] == [REAL_SECTION_ID]
        assert (kept, dropped) == (1, 1)

    def test_a_section_left_unsourced_stays_empty(self) -> None:
        """No back-filling. An unsourced paragraph is a real signal."""
        cleaned, kept, dropped = _strip_unknown_section_ids(
            _outline([[FABRICATED_SECTION_ID]]),
            {REAL_SECTION_ID},
        )
        assert cleaned["modelAnswer"]["outlineSections"][0]["citedSectionIds"] == []
        assert (kept, dropped) == (0, 1)

    def test_the_input_is_not_mutated(self) -> None:
        original = _outline([[FABRICATED_SECTION_ID]])
        _strip_unknown_section_ids(original, {REAL_SECTION_ID})
        assert original["modelAnswer"]["outlineSections"][0]["citedSectionIds"] == [
            FABRICATED_SECTION_ID
        ]

    def test_duplicates_collapse(self) -> None:
        cleaned, kept, _dropped = _strip_unknown_section_ids(
            _outline([[REAL_SECTION_ID, REAL_SECTION_ID]]),
            {REAL_SECTION_ID},
        )
        assert cleaned["modelAnswer"]["outlineSections"][0]["citedSectionIds"] == [
            REAL_SECTION_ID
        ]
        assert kept == 1

    def test_non_string_entries_are_dropped(self) -> None:
        _cleaned, kept, dropped = _strip_unknown_section_ids(
            _outline([[None, 42, {"id": REAL_SECTION_ID}]]),
            {REAL_SECTION_ID},
        )
        assert (kept, dropped) == (0, 3)

    @pytest.mark.parametrize(
        "content",
        [
            {},
            {"modelAnswer": None},
            {"modelAnswer": {"outlineSections": "nope"}},
            {"modelAnswer": {"outlineSections": [None, {"citedSectionIds": None}]}},
        ],
    )
    def test_malformed_shapes_do_not_raise(self, content: dict[str, Any]) -> None:
        cleaned, kept, dropped = _strip_unknown_section_ids(content, {REAL_SECTION_ID})
        assert (kept, dropped) == (0, 0)
        assert cleaned == content


def _run(
    mock_validate: MagicMock,
    mock_db: MagicMock,
    mock_rag: MagicMock,
    mock_nestjs: MagicMock,
    cited: list[list[str]],
) -> dict[str, Any]:
    """Drive the task with an LLM answer citing ``cited``, return the payload."""
    from src.validators.derivative_validators import (
        DerivativeValidationResult,
        DerivativeVerdict,
    )

    content = json.loads(json.dumps(FAKE_LLM_CONTENT))
    content["modelAnswer"]["outlineSections"] = [
        {"heading": heading, "paragraphs": ["Some analysis."], "citedSectionIds": ids}
        for heading, ids in zip(ALAC, cited, strict=True)
    ]

    mock_db.get_legal_document.return_value = FAKE_DOC
    mock_db.get_document_sections_for_digest.return_value = UUID_SECTIONS
    mock_db.create_model_run.return_value = "model-run-001"
    # Concrete, so the payload stays JSON-serialisable for the "no fabricated
    # ID survives anywhere in it" assertion below.
    mock_db.get_content_disclaimer_id.return_value = "disclaimer-001"
    mock_rag.generate_completion.return_value = {**FAKE_RAG_RESPONSE, "content": content}
    mock_validate.return_value = DerivativeValidationResult(
        verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
    )
    mock_nestjs.write_essay.return_value = {
        "artifactId": "art-001",
        "essayPromptId": "essay-001",
    }
    mock_nestjs.update_job_status.return_value = True

    result = generate_essay_prompt.run("job-001", "doc-001")
    assert result["status"] == "completed"
    payload: dict[str, Any] = mock_nestjs.write_essay.call_args.args[0]
    return payload


@patch("src.tasks.essay_generation_tasks.nestjs_client")
@patch("src.tasks.essay_generation_tasks.rag_client")
@patch("src.tasks.essay_generation_tasks.db")
@patch("src.tasks.essay_generation_tasks.validate_derivative")
class TestFabricatedCitationsDoNotReachStorage:
    """Acceptance: the whole path, from LLM output to write payload."""

    def test_a_fabricated_id_is_stripped_and_scored_accordingly(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """The acceptance case: a UUID absent from the retrieved set.

        Two of four outline sections cite it and nothing else, so after the
        strip they are empty and the citation term is 2/4, not 4/4.
        """
        payload = _run(
            mock_validate,
            mock_db,
            mock_rag,
            mock_nestjs,
            [
                [REAL_SECTION_ID],
                [FABRICATED_SECTION_ID],
                [OTHER_REAL_SECTION_ID],
                [FABRICATED_SECTION_ID],
            ],
        )

        stored = [
            s["citedSectionIds"]
            for s in payload["contentJson"]["modelAnswer"]["outlineSections"]
        ]
        assert stored == [[REAL_SECTION_ID], [], [OTHER_REAL_SECTION_ID], []]

        # modelAnswerJson is a separate column and must not keep a copy.
        assert payload["modelAnswerJson"] == payload["contentJson"]["modelAnswer"]
        assert FABRICATED_SECTION_ID not in json.dumps(payload)

        # coverage: 2 valid / min(2 sections, 4 items * 2) = 1.0
        # citation: 2 of 4 outline sections grounded = 0.5
        # ocr: 1.0
        assert payload["confidenceScore"] == pytest.approx(
            round(1.0 * 0.5 + 0.5 * 0.3 + 1.0 * 0.2, 4)
        )

    def test_a_wholly_fabricated_essay_scores_the_floor(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """0.2, not the 0.5 presence-only scoring produced. Far below 0.70."""
        payload = _run(
            mock_validate,
            mock_db,
            mock_rag,
            mock_nestjs,
            [[FABRICATED_SECTION_ID]] * 4,
        )

        assert payload["confidenceScore"] == pytest.approx(0.2)
        assert payload["confidenceScore"] < CONFIDENCE_THRESHOLD

    def test_provenance_carries_only_ids_the_essay_cited(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        payload = _run(
            mock_validate,
            mock_db,
            mock_rag,
            mock_nestjs,
            [[REAL_SECTION_ID], [FABRICATED_SECTION_ID]] * 2,
        )

        assert [
            r["sourceSectionId"] for r in payload["provenanceRecords"]
        ] == [REAL_SECTION_ID]

    def test_an_honestly_cited_essay_is_untouched(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Nothing about this change may move a well-grounded essay."""
        cited = [[REAL_SECTION_ID], [OTHER_REAL_SECTION_ID]] * 2
        payload = _run(mock_validate, mock_db, mock_rag, mock_nestjs, cited)

        stored = [
            s["citedSectionIds"]
            for s in payload["contentJson"]["modelAnswer"]["outlineSections"]
        ]
        assert stored == cited
        assert payload["confidenceScore"] == pytest.approx(1.0)

    def test_the_validator_sees_the_cleaned_content(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Order matters: strip, then validate.

        The validator's "section not in source" check can no longer fire, and
        its "paragraph has no citedSectionIds" check now does — the honest
        signal, which routes the artifact to human review.
        """
        _run(
            mock_validate,
            mock_db,
            mock_rag,
            mock_nestjs,
            [[REAL_SECTION_ID], [FABRICATED_SECTION_ID]] * 2,
        )

        seen = mock_validate.call_args.kwargs["content"]
        cited = [s["citedSectionIds"] for s in seen["modelAnswer"]["outlineSections"]]
        assert cited == [[REAL_SECTION_ID], [], [REAL_SECTION_ID], []]


class TestPromptEnumeratesTheAllowedIds:
    """The model gets a closed list, not only IDs buried in passage headers."""

    def test_available_section_ids_block_lists_every_id(self) -> None:
        prompt = build_user_prompt(
            title="T",
            citation="C",
            court="SC",
            decision_date="2025-01-01",
            subject="Crim",
            source_type="decision",
            sections=UUID_SECTIONS,
        )
        assert "---AVAILABLE SECTION IDS---" in prompt
        block = prompt.split("---AVAILABLE SECTION IDS---")[1].split(
            "---END AVAILABLE SECTION IDS---"
        )[0]
        assert REAL_SECTION_ID in block
        assert OTHER_REAL_SECTION_ID in block

    def test_sections_without_an_id_are_skipped(self) -> None:
        assert (
            build_section_ids_text(
                [{"id": REAL_SECTION_ID}, {"section_type": "body"}, {"id": ""}]
            )
            == REAL_SECTION_ID
        )

    def test_the_schema_example_carries_no_id_shaped_placeholder(self) -> None:
        """v1's example showed "section-uuid-1". No other prompt does that.

        An example that models what an ID looks like is an invitation to
        produce something of that shape when none of the real ones fit.
        """
        assert "section-uuid" not in ESSAY_GENERATION_SYSTEM_PROMPT

    def test_the_model_is_told_an_empty_list_is_acceptable(self) -> None:
        """v1 said "Do not write unsourced paragraphs" and offered no way out."""
        assert "empty" in ESSAY_GENERATION_SYSTEM_PROMPT.lower()
        assert "invent" in ESSAY_GENERATION_SYSTEM_PROMPT.lower()

    def test_the_version_marks_the_change(self) -> None:
        """model_runs is how a verification run segments pre/post fix."""
        assert PROMPT_TEMPLATE_VERSION == "essay_generation.v2"
