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


class TestPromptVersion:
    def test_version_bumped_for_the_sentinel_instruction(self) -> None:
        """CLAUDE.md requires prompt_template_version be recorded per inference.

        A changed instruction under an unchanged version makes `model_runs`
        unauditable — two different prompts recorded as the same template.
        """
        assert PROMPT_VERSION == "answer-v1.2"
