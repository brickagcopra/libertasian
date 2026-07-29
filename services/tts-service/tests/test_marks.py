"""Mark-format and failure-path tests for the synthesis assembler."""

import json

import numpy as np
import pytest

from src.synthesis import MissingWordTimingsError, _Token, synthesize_document


class _FakeSynthesizer:
    """Deterministic stand-in: 1s of audio per segment, one token per word."""

    def __init__(self, *, with_timings: bool = True) -> None:
        self.with_timings = with_timings

    def synthesize_segment(self, text, voice):  # noqa: ANN001, ARG002
        audio = np.zeros(24_000, dtype=np.float32)
        if not self.with_timings:
            raise MissingWordTimingsError("no word timings")
        words = text.split()
        step = 1.0 / max(len(words), 1)
        tokens = [
            _Token(text=w.strip(".,"), start_s=i * step, end_s=(i + 1) * step)
            for i, w in enumerate(words)
        ]
        return audio, tokens


def _parse(ndjson: str) -> list[dict]:
    return [json.loads(line) for line in ndjson.splitlines() if line.strip()]


def test_emits_one_ssml_mark_per_segment() -> None:
    _, marks = synthesize_document(
        _FakeSynthesizer(),
        [("seg-0", "Alpha bravo", 0), ("seg-1", "Charlie delta", 0)],
        "af_heart",
    )
    ssml = [m for m in _parse(marks) if m["type"] == "ssml"]
    assert [m["value"] for m in ssml] == ["seg-0", "seg-1"]


def test_lead_silence_shifts_the_following_segment_onset() -> None:
    _, marks = synthesize_document(
        _FakeSynthesizer(),
        [("seg-0", "Alpha bravo", 0), ("seg-1", "Charlie delta", 700)],
        "af_heart",
    )
    ssml = [m for m in _parse(marks) if m["type"] == "ssml"]
    # 1000ms of segment 0 + 700ms of lead silence.
    assert ssml[1]["time"] == 1700


def test_every_mark_type_is_present() -> None:
    _, marks = synthesize_document(
        _FakeSynthesizer(), [("seg-0", "Alpha bravo", 0)], "af_heart"
    )
    assert {m["type"] for m in _parse(marks)} == {"ssml", "sentence", "word"}


def test_word_and_sentence_marks_always_carry_finite_offsets() -> None:
    """The web parser DROPS any mark lacking finite start/end."""
    _, marks = synthesize_document(
        _FakeSynthesizer(), [("seg-0", "Alpha bravo charlie", 0)], "af_heart"
    )
    for mark in _parse(marks):
        if mark["type"] in ("word", "sentence"):
            assert isinstance(mark["start"], int)
            assert isinstance(mark["end"], int)
            assert mark["end"] > mark["start"]


def test_repeated_word_gets_distinct_offsets() -> None:
    """A running cursor, not first-occurrence search."""
    _, marks = synthesize_document(
        _FakeSynthesizer(), [("seg-0", "alpha alpha alpha", 0)], "af_heart"
    )
    starts = [m["start"] for m in _parse(marks) if m["type"] == "word"]
    assert len(starts) == len(set(starts)), f"offsets collided: {starts}"


def test_offsets_increase_monotonically_across_segments() -> None:
    _, marks = synthesize_document(
        _FakeSynthesizer(),
        [("seg-0", "alpha bravo", 0), ("seg-1", "alpha bravo", 0)],
        "af_heart",
    )
    sentences = [m for m in _parse(marks) if m["type"] == "sentence"]
    assert sentences[1]["start"] > sentences[0]["end"] - 1


def test_raises_when_word_timings_are_unavailable() -> None:
    with pytest.raises(MissingWordTimingsError):
        synthesize_document(
            _FakeSynthesizer(with_timings=False),
            [("seg-0", "Alpha bravo", 0)],
            "af_heart",
        )
