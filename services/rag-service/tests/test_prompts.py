"""Tests for answer/prompts.py — the pipeline's contract with the prompt text.

The INSUFFICIENT_SOURCES sentinel is a protocol between the prompt and
``answer/service.py``. Nothing else enforces that the constant the service
matches on is the token the prompt actually asks the model to emit, so these
tests do.
"""

from __future__ import annotations

import pytest

from src.answer.prompts import (
    INSUFFICIENT_SOURCES_SENTINEL,
    PROMPT_VERSION,
    STREAMING_SYSTEM_PROMPT,
    SYSTEM_PROMPT,
)


class TestInsufficientSourcesSentinel:
    @pytest.mark.parametrize(
        "prompt",
        [SYSTEM_PROMPT, STREAMING_SYSTEM_PROMPT],
        ids=["system", "streaming"],
    )
    def test_sentinel_is_instructed_verbatim(self, prompt: str) -> None:
        assert INSUFFICIENT_SOURCES_SENTINEL in prompt

    @pytest.mark.parametrize(
        "prompt",
        [SYSTEM_PROMPT, STREAMING_SYSTEM_PROMPT],
        ids=["system", "streaming"],
    )
    # Name length is load-bearing: TruffleHog's Lob detector matches
    # `test_` + exactly 35 characters and "verifies" it, so a 35-character
    # suffix fails the Secret Detection job on a pytest function name.
    def test_sentinel_must_stand_alone_on_its_own_line(self, prompt: str) -> None:
        """The detector reads one line; the prompt must ask for exactly one."""
        assert "nothing else" in prompt

    @pytest.mark.parametrize(
        "prompt",
        [SYSTEM_PROMPT, STREAMING_SYSTEM_PROMPT],
        ids=["system", "streaming"],
    )
    def test_no_longer_asks_for_undetectable_prose(self, prompt: str) -> None:
        """"say so explicitly" produced non-answers that rendered as answers."""
        assert "say so explicitly" not in prompt


class TestPartialAnswerInstruction:
    """v1.2's binary framing made the sentinel a cheap exit the model took.

    "If the SOURCE PASSAGES do not contain enough information" invited the model
    to refuse on anything short of complete coverage, and it did: A/B tested
    in-memory against prod, v1.2 answered 0 of 5 realistic queries. v1.3 makes a
    partial cited answer the expected output and reserves the sentinel for
    passages with nothing relevant in them.
    """

    @pytest.mark.parametrize(
        "prompt",
        [SYSTEM_PROMPT, STREAMING_SYSTEM_PROMPT],
        ids=["system", "streaming"],
    )
    def test_partial_answers_are_preferred(self, prompt: str) -> None:
        assert "A partial, cited answer is always preferred" in prompt

    @pytest.mark.parametrize(
        "prompt",
        [SYSTEM_PROMPT, STREAMING_SYSTEM_PROMPT],
        ids=["system", "streaming"],
    )
    def test_sentinel_needs_nothing_relevant(self, prompt: str) -> None:
        """The bar is "NOTHING relevant", not "not enough to answer fully"."""
        assert "NOTHING relevant to the question at all" in prompt
        assert "not merely incomplete, partial or tangential" in prompt

    @pytest.mark.parametrize(
        "prompt",
        [SYSTEM_PROMPT, STREAMING_SYSTEM_PROMPT],
        ids=["system", "streaming"],
    )
    def test_over_firing_is_named_an_error(self, prompt: str) -> None:
        assert "support even a partial answer is an error" in prompt

    @pytest.mark.parametrize(
        "prompt",
        [SYSTEM_PROMPT, STREAMING_SYSTEM_PROMPT],
        ids=["system", "streaming"],
    )
    def test_binary_enough_framing_is_gone(self, prompt: str) -> None:
        assert "do not contain enough information" not in prompt

    def test_both_prompts_share_instruction_3(self) -> None:
        """Streaming and non-streaming must not drift on this one instruction."""
        from src.answer.prompts import _INSTRUCTION_3

        assert _INSTRUCTION_3 in SYSTEM_PROMPT
        assert _INSTRUCTION_3 in STREAMING_SYSTEM_PROMPT

    @pytest.mark.parametrize(
        "prompt",
        [SYSTEM_PROMPT, STREAMING_SYSTEM_PROMPT],
        ids=["system", "streaming"],
    )
    def test_instruction_numbering_intact(self, prompt: str) -> None:
        """Instruction 3 is spliced in; a bad splice silently renumbers the list."""
        for n in (1, 2, 3, 4):
            assert f"\n{n}. " in f"\n{prompt}"


class TestBareTopicQueries:
    """v1.4: the query's FORM is never a reason to abstain.

    v1.3 fixed coverage — a partial answer beats the sentinel. It did not fix
    query form: the one-word query "constitution" still abstained with
    retrieval filtered to the 1987 Constitution itself, so nothing about the
    passages' content justified the refusal. The model was declining because
    the query did not look like a question.
    """

    @pytest.mark.parametrize(
        "prompt",
        [SYSTEM_PROMPT, STREAMING_SYSTEM_PROMPT],
        ids=["system", "streaming"],
    )
    def test_bare_topic_is_answerable(self, prompt: str) -> None:
        assert "A query may be a bare topic, keyword or phrase rather than a question" in prompt
        assert (
            "Treat such a query as a request to explain what the SOURCE PASSAGES "
            "say about that topic" in prompt
        )

    @pytest.mark.parametrize(
        "prompt",
        [SYSTEM_PROMPT, STREAMING_SYSTEM_PROMPT],
        ids=["system", "streaming"],
    )
    def test_query_form_is_never_grounds_to_abstain(self, prompt: str) -> None:
        assert (
            "The form, length or breadth of the query is never itself a reason "
            f"to emit {INSUFFICIENT_SOURCES_SENTINEL}; only the passages' content is." in prompt
        )


class TestPromptVersion:
    def test_version_matches_instruction_3(self) -> None:
        """CLAUDE.md requires prompt_template_version be recorded per inference.

        A changed instruction under an unchanged version makes `model_runs`
        unauditable — two different prompts recorded as the same template. v1.3
        was the partial-answer rewrite of instruction 3; v1.4 adds the
        bare-topic clause to the same instruction.
        """
        assert PROMPT_VERSION == "answer-v1.4"
