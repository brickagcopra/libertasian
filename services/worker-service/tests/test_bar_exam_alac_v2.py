"""Tests for the grounded bar exam ALAC prompt (v2).

The point of v2 is that a citation becomes checkable. These tests cover the
two halves of that: the prompt offers a closed list of ids, and the filter
drops anything outside it before the row is written.
"""

from __future__ import annotations

from src.prompts.bar_exam_alac_v2 import (
    BAR_EXAM_ALAC_V2_SYSTEM_PROMPT,
    PROMPT_TEMPLATE_VERSION,
    build_user_prompt,
    citable_section_ids,
    filter_cited_section_ids,
    parse_alac_response,
    render_answer_markdown,
)

SEC_A = "aaaaaaaa-0000-4000-8000-000000000001"
SEC_B = "bbbbbbbb-0000-4000-8000-000000000001"
FABRICATED = "00000000-dead-4000-8000-000000000bad"

def _passage(hit: str, section_id: str | None, document_id: str, title: str, text: str):
    return {
        "id": hit,
        "section_id": section_id,
        "document_id": document_id,
        "title": title,
        "text": text,
    }


PASSAGES = [
    _passage("h1", SEC_A, "doc-a", "RPC Art. 315", "estafa"),
    _passage("h2", SEC_B, "doc-b", "People v. X", "ruling"),
    _passage("h3", None, "doc-c", "Untitled", "orphan"),
]


class TestVersionString:
    def test_version_is_v2(self):
        assert PROMPT_TEMPLATE_VERSION == "bar_exam_alac.v2"


class TestSystemPrompt:
    def test_closed_list_is_mandated(self):
        assert "CITABLE SECTION IDS" in BAR_EXAM_ALAC_V2_SYSTEM_PROMPT

    def test_empty_array_is_explicitly_permitted(self):
        """Removing the incentive to invent an id is the whole essay lesson."""
        assert "EMPTY" in BAR_EXAM_ALAC_V2_SYSTEM_PROMPT

    def test_untrusted_input_boundary_survives_from_v1(self):
        assert "untrusted data" in BAR_EXAM_ALAC_V2_SYSTEM_PROMPT

    def test_schema_declares_cited_section_ids(self):
        assert '"citedSectionIds"' in BAR_EXAM_ALAC_V2_SYSTEM_PROMPT


class TestCitableSectionIds:
    def test_only_passages_with_a_section_id_are_citable(self):
        assert citable_section_ids(PASSAGES) == [SEC_A, SEC_B]

    def test_duplicates_collapse(self):
        duplicated = PASSAGES + [dict(PASSAGES[0])]
        assert citable_section_ids(duplicated) == [SEC_A, SEC_B]

    def test_no_passages_yields_no_citable_ids(self):
        assert citable_section_ids(None) == []
        assert citable_section_ids([]) == []


class TestBuildUserPrompt:
    def test_closed_list_is_printed(self):
        prompt = build_user_prompt("Q?", "criminal_law", 2007, PASSAGES)
        assert "---CITABLE SECTION IDS---" in prompt
        assert SEC_A in prompt
        assert SEC_B in prompt

    def test_passage_without_section_id_is_labelled_uncitable(self):
        prompt = build_user_prompt("Q?", "criminal_law", 2007, PASSAGES)
        assert "[uncitable]" in prompt

    def test_passages_are_labelled_with_the_id_the_model_must_cite(self):
        prompt = build_user_prompt("Q?", None, 2007, PASSAGES)
        assert f"[{SEC_A}] RPC Art. 315" in prompt

    def test_empty_citable_list_says_so_rather_than_printing_nothing(self):
        only_orphans = [PASSAGES[2]]
        prompt = build_user_prompt("Q?", None, 2007, only_orphans)
        assert "citedSectionIds" in prompt
        assert "none" in prompt

    def test_question_text_and_subject_are_present(self):
        prompt = build_user_prompt("What is estafa?", "criminal_law", 2006, PASSAGES)
        assert "What is estafa?" in prompt
        assert "criminal_law" in prompt
        assert "2006" in prompt

    def test_no_passages_means_no_citable_block(self):
        prompt = build_user_prompt("Q?", None, 2007, None)
        assert "CITABLE SECTION IDS" not in prompt


class TestParseAlacResponse:
    def _valid(self, **overrides):
        base = {
            "answer": "Yes.",
            "law": "Art. 315.",
            "analysis": "Because.",
            "conclusion": "Therefore yes.",
        }
        base.update(overrides)
        return base

    def test_cited_ids_are_returned(self):
        parsed = parse_alac_response(self._valid(citedSectionIds=[SEC_A, SEC_B]))
        assert parsed is not None
        assert parsed["citedSectionIds"] == [SEC_A, SEC_B]

    def test_missing_key_normalizes_to_empty_list(self):
        parsed = parse_alac_response(self._valid())
        assert parsed is not None
        assert parsed["citedSectionIds"] == []

    def test_null_normalizes_to_empty_list(self):
        parsed = parse_alac_response(self._valid(citedSectionIds=None))
        assert parsed is not None
        assert parsed["citedSectionIds"] == []

    def test_bare_string_is_wrapped(self):
        parsed = parse_alac_response(self._valid(citedSectionIds=SEC_A))
        assert parsed is not None
        assert parsed["citedSectionIds"] == [SEC_A]

    def test_non_string_entries_are_dropped_not_rejected(self):
        """A junk citation list must not throw away a usable answer."""
        parsed = parse_alac_response(self._valid(citedSectionIds=[SEC_A, 42, None, {}]))
        assert parsed is not None
        assert parsed["citedSectionIds"] == [SEC_A]

    def test_duplicates_collapse(self):
        parsed = parse_alac_response(self._valid(citedSectionIds=[SEC_A, SEC_A]))
        assert parsed is not None
        assert parsed["citedSectionIds"] == [SEC_A]

    def test_missing_alac_field_still_rejects(self):
        assert parse_alac_response(self._valid(law="")) is None

    def test_abstention_rejects(self):
        assert parse_alac_response(self._valid(abstain=True)) is None


class TestFilterCitedSectionIds:
    def test_fabricated_id_is_dropped(self):
        structured = {"answer": "a", "citedSectionIds": [SEC_A, FABRICATED]}
        cleaned, kept, dropped = filter_cited_section_ids(structured, {SEC_A, SEC_B})
        assert cleaned["citedSectionIds"] == [SEC_A]
        assert (kept, dropped) == (1, 1)

    def test_answer_with_nothing_valid_keeps_an_empty_list(self):
        """Never back-fill: an unsourced answer must look unsourced."""
        structured = {"answer": "a", "citedSectionIds": [FABRICATED]}
        cleaned, kept, dropped = filter_cited_section_ids(structured, {SEC_A})
        assert cleaned["citedSectionIds"] == []
        assert (kept, dropped) == (0, 1)

    def test_input_dict_is_not_mutated(self):
        structured = {"answer": "a", "citedSectionIds": [SEC_A, FABRICATED]}
        filter_cited_section_ids(structured, {SEC_A})
        assert structured["citedSectionIds"] == [SEC_A, FABRICATED]

    def test_other_fields_survive(self):
        structured = {
            "answer": "a",
            "law": "l",
            "analysis": "an",
            "conclusion": "c",
            "citedSectionIds": [SEC_A],
        }
        cleaned, _, _ = filter_cited_section_ids(structured, {SEC_A})
        assert cleaned["law"] == "l"
        assert cleaned["conclusion"] == "c"

    def test_missing_key_yields_empty_list(self):
        cleaned, kept, dropped = filter_cited_section_ids({"answer": "a"}, {SEC_A})
        assert cleaned["citedSectionIds"] == []
        assert (kept, dropped) == (0, 0)


class TestRenderAnswerMarkdown:
    def test_all_four_alac_labels_render(self):
        markdown = render_answer_markdown(
            {"answer": "A", "law": "L", "analysis": "AN", "conclusion": "C"}
        )
        for label in ("**Answer.**", "**Law.**", "**Analysis.**", "**Conclusion.**"):
            assert label in markdown

    def test_uuids_are_not_pasted_into_the_prose(self):
        markdown = render_answer_markdown(
            {
                "answer": "A",
                "law": "L",
                "analysis": "AN",
                "conclusion": "C",
                "citedSectionIds": [SEC_A],
            }
        )
        assert SEC_A not in markdown
