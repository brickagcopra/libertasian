"""Tests for the authority-grouped bar exam ALAC prompt (v3).

v3 changes what the model sees, not what it returns, so these tests are almost
entirely about the rendered prompt: passages grouped under the authority they
came from, uncitable passages kept out of the closed list, and — the part that
is easy to regress — no citation count target and no mention of scoring
anywhere in the text.

The contract half (parse / filter / render) is v2's, imported rather than
copied, and is covered by ``test_bar_exam_alac_v2.py``. The tests here assert
that it really is the same object.
"""

from __future__ import annotations

import re

from src.prompts import bar_exam_alac_v2 as v2
from src.prompts.bar_exam_alac_v3 import (
    BAR_EXAM_ALAC_V3_SYSTEM_PROMPT,
    PROMPT_TEMPLATE_VERSION,
    build_user_prompt,
    citable_section_ids,
    filter_cited_section_ids,
    group_passages_by_authority,
    parse_alac_response,
    render_answer_markdown,
)

SEC_A1 = "aaaaaaaa-0000-4000-8000-000000000001"
SEC_A2 = "aaaaaaaa-0000-4000-8000-000000000002"
SEC_B1 = "bbbbbbbb-0000-4000-8000-000000000001"
DOC_A = "11111111-1111-4111-8111-111111111111"
DOC_B = "22222222-2222-4222-8222-222222222222"
DOC_C = "33333333-3333-4333-8333-333333333333"


def _passage(section_id, document_id, title, text, hit="h"):
    return {
        "id": hit,
        "section_id": section_id,
        "document_id": document_id,
        "title": title,
        "text": text,
        "score": 100.0,
    }


# Two sections of one statute, one section of a case, and an uncitable
# passage from a third document — the shape the breadth term is trying to
# tell apart.
PASSAGES = [
    _passage(SEC_A1, DOC_A, "Revised Penal Code, Art. 315", "estafa defined"),
    _passage(SEC_A2, DOC_A, "Revised Penal Code, Art. 315", "penalties"),
    _passage(SEC_B1, DOC_B, "People v. Balasa", "elements applied"),
    _passage(None, DOC_C, "Source", "orphan passage with no section id"),
]


class TestVersionString:
    def test_version_is_v3(self):
        assert PROMPT_TEMPLATE_VERSION == "bar_exam_alac.v3"


class TestContractIsSharedWithV2:
    def test_parse_filter_render_and_citable_are_the_same_objects(self):
        """Not "equivalent" — the same function objects.

        A copy would drift: a fix to the filter would land on one template and
        not the other, and rows generated a week apart would be filtered by
        different code while claiming the same contract.
        """
        assert parse_alac_response is v2.parse_alac_response
        assert filter_cited_section_ids is v2.filter_cited_section_ids
        assert render_answer_markdown is v2.render_answer_markdown
        assert citable_section_ids is v2.citable_section_ids


class TestSystemPrompt:
    def test_closed_list_is_still_mandated(self):
        assert "CITABLE SECTION IDS" in BAR_EXAM_ALAC_V3_SYSTEM_PROMPT

    def test_empty_array_is_still_explicitly_permitted(self):
        assert "EMPTY" in BAR_EXAM_ALAC_V3_SYSTEM_PROMPT

    def test_untrusted_input_boundary_survives(self):
        assert "untrusted data" in BAR_EXAM_ALAC_V3_SYSTEM_PROMPT

    def test_abstain_rule_survives(self):
        assert "abstain=true" in BAR_EXAM_ALAC_V3_SYSTEM_PROMPT
        assert "abstainReason" in BAR_EXAM_ALAC_V3_SYSTEM_PROMPT

    def test_schema_example_shows_ids_from_more_than_one_authority(self):
        """The single-placeholder example is the suspected cause of 15/26
        answers citing exactly one section when three documents were on offer.
        """
        match = re.search(
            r'"citedSectionIds":\s*\[(.*?)\]',
            BAR_EXAM_ALAC_V3_SYSTEM_PROMPT,
            flags=re.DOTALL,
        )
        assert match, "schema example must declare citedSectionIds"
        placeholders = [p for p in match.group(1).split(",") if p.strip()]
        assert len(placeholders) > 1
        assert "authority 1" in match.group(1)
        assert "authority 2" in match.group(1)

    def test_authorities_are_explained_as_a_grouping(self):
        assert "AUTHORITY" in BAR_EXAM_ALAC_V3_SYSTEM_PROMPT
        # Whitespace-normalized: the rule is wrapped across lines.
        flat = " ".join(BAR_EXAM_ALAC_V3_SYSTEM_PROMPT.split())
        assert "same statute, rule or decision" in flat
        assert "different headings come from different ones" in flat

    def test_no_numeric_citation_target(self):
        """A count target would raise the score without raising quality.

        The score cannot tell a relevant citation from an irrelevant one that
        resolves, so "cite at least two" buys pass rate and nothing else.
        """
        text = BAR_EXAM_ALAC_V3_SYSTEM_PROMPT.lower()
        for forbidden in (
            "at least",
            "minimum",
            "at minimum",
            "two ids",
            "three ids",
            "two sections",
            "three sections",
            "two authorities",
            "three authorities",
            "as many",
        ):
            assert forbidden not in text, f"numeric citation target: {forbidden}"
        assert not re.search(r"cite (at least |exactly )?\d", text)

    def test_scoring_is_never_mentioned(self):
        text = BAR_EXAM_ALAC_V3_SYSTEM_PROMPT.lower()
        for forbidden in ("score", "scoring", "confidence", "0.70", "grade"):
            assert forbidden not in text, f"prompt leaks the scorer: {forbidden}"

    def test_strictly_better_framing_is_gone(self):
        assert "strictly better" not in BAR_EXAM_ALAC_V3_SYSTEM_PROMPT


class TestGrouping:
    def test_passages_group_by_document_in_retrieval_order(self):
        groups = group_passages_by_authority(PASSAGES)
        assert len(groups) == 3
        assert groups[0][0] == "Revised Penal Code, Art. 315"
        assert groups[1][0] == "People v. Balasa"
        # The two RPC passages collapse into the first group; the top-ranked
        # document is AUTHORITY 1.
        assert len(groups[0][1]) == 2
        assert len(groups[1][1]) == 1
        assert len(groups[2][1]) == 1

    def test_generic_source_title_is_only_used_when_nothing_better_exists(self):
        groups = group_passages_by_authority(
            [
                _passage(SEC_A1, DOC_A, "Source", "first"),
                _passage(SEC_A2, DOC_A, "Civil Code, Art. 1156", "second"),
            ],
        )
        assert groups[0][0] == "Civil Code, Art. 1156"

    def test_passages_without_a_document_collapse_into_one_group(self):
        """One AUTHORITY per unattributed passage would tell the model it had
        more distinct authorities than retrieval actually found.
        """
        groups = group_passages_by_authority(
            [
                _passage(SEC_A1, "", "Untitled", "one"),
                _passage(SEC_A2, "", "Untitled", "two"),
            ],
        )
        assert len(groups) == 1
        assert "source not identified" in groups[0][0]

    def test_no_passages_is_no_groups(self):
        assert group_passages_by_authority(None) == []
        assert group_passages_by_authority([]) == []


class TestUserPrompt:
    def test_sections_of_one_document_sit_under_one_authority_heading(self):
        prompt = build_user_prompt("Q?", "criminal_law", 2018, PASSAGES)
        assert "AUTHORITY 1 — Revised Penal Code, Art. 315" in prompt
        assert "AUTHORITY 2 — People v. Balasa" in prompt
        # Two sections of the same statute, one heading — the distinction the
        # flat v2 layout could not express.
        assert prompt.count("Revised Penal Code, Art. 315") == 2  # passages + ids

    def test_every_passage_is_tagged_with_the_id_it_must_be_cited_by(self):
        prompt = build_user_prompt("Q?", None, 2018, PASSAGES)
        assert f"[{SEC_A1}]" in prompt
        assert f"[{SEC_A2}]" in prompt
        assert f"[{SEC_B1}]" in prompt

    def test_uncitable_passage_is_shown_but_excluded_from_the_closed_list(self):
        prompt = build_user_prompt("Q?", None, 2018, PASSAGES)
        assert "[uncitable]" in prompt
        assert "orphan passage with no section id" in prompt

        citable_block = prompt.split("---CITABLE SECTION IDS---")[1].split(
            "---END CITABLE SECTION IDS---",
        )[0]
        assert SEC_A1 in citable_block
        assert SEC_B1 in citable_block
        assert "uncitable" not in citable_block

    def test_citable_block_repeats_the_authority_grouping(self):
        prompt = build_user_prompt("Q?", None, 2018, PASSAGES)
        citable_block = prompt.split("---CITABLE SECTION IDS---")[1].split(
            "---END CITABLE SECTION IDS---",
        )[0]
        assert "AUTHORITY 1 — Revised Penal Code, Art. 315" in citable_block
        assert "AUTHORITY 2 — People v. Balasa" in citable_block
        # The third document contributed no citable section, so it is not
        # offered as a citable authority at all.
        assert "AUTHORITY 3" not in citable_block

    def test_empty_citable_list_says_so_rather_than_printing_nothing(self):
        prompt = build_user_prompt(
            "Q?",
            None,
            2018,
            [_passage(None, DOC_A, "Untitled", "text")],
        )
        assert "(none —" in prompt
        assert '"citedSectionIds": []' in prompt

    def test_question_text_and_subject_are_present(self):
        prompt = build_user_prompt("Discuss estafa.", "criminal_law", 2018, PASSAGES)
        assert "Discuss estafa." in prompt
        assert "criminal_law" in prompt
        assert "2018" in prompt

    def test_no_passages_means_no_citable_block(self):
        prompt = build_user_prompt("Q?", None, 2018, None)
        assert "CITABLE SECTION IDS" not in prompt
        assert "AUTHORITY" not in prompt
        assert "Q?" in prompt

    def test_prompt_body_states_no_citation_count(self):
        prompt = build_user_prompt("Q?", "criminal_law", 2018, PASSAGES)
        assert "at least" not in prompt.lower()
        assert "score" not in prompt.lower()
