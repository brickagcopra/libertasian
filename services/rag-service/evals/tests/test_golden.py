"""Shape and coverage guarantees for evals/golden/answers.jsonl."""

from __future__ import annotations

import json
from collections import Counter

import pytest

from evals.metrics import gr_keys, instrument_numbers, statute_instrument
from evals.model import (
    GOLDEN_PATH,
    SUBJECTS,
    GoldenFormatError,
    load_golden,
    parse_golden_line,
)

ENTRIES = load_golden()


def test_every_line_is_a_json_object() -> None:
    for lineno, line in enumerate(GOLDEN_PATH.read_text(encoding="utf-8").splitlines(), 1):
        assert line.strip(), f"blank line {lineno}"
        assert isinstance(json.loads(line), dict), f"line {lineno}"


def test_counts() -> None:
    answerable = [e for e in ENTRIES if not e.must_abstain]
    abstain = [e for e in ENTRIES if e.must_abstain]
    assert len(answerable) == 40
    assert len(abstain) == 5


def test_all_eight_subjects_covered_evenly() -> None:
    per_subject = Counter(e.subject for e in ENTRIES if not e.must_abstain)
    assert set(per_subject) == set(SUBJECTS)
    assert len(SUBJECTS) == 8
    assert min(per_subject.values()) >= 4, per_subject


def test_nothing_is_marked_reviewed_by_the_generator() -> None:
    # Flip to True per entry only after a lawyer has checked it.
    assert all(e.reviewed is False for e in ENTRIES)


def test_authorities_are_environment_independent() -> None:
    for e in ENTRIES:
        for a in e.expected_authorities:
            if a.kind == "gr_no":
                assert gr_keys(a.value), f"{e.id}: unparseable G.R. number {a.value!r}"
                assert a.value.startswith("G.R. No. "), f"{e.id}: use canonical form"
            elif a.kind == "statute":
                assert statute_instrument(a.value), f"{e.id}: no instrument in {a.value!r}"
            # Never a DB id (uuid / cuid): ids differ between environments.
            assert not any(len(tok) >= 20 and tok.isalnum() for tok in a.value.split())


def test_numbered_statutes_parse() -> None:
    for e in ENTRIES:
        for a in e.expected_authorities:
            if a.kind == "statute" and a.value.startswith(("R.A.", "P.D.", "A.M.", "Act No.")):
                assert instrument_numbers(statute_instrument(a.value)), f"{e.id}: {a.value}"


@pytest.mark.parametrize(
    "line",
    [
        "not json",
        "[]",
        '{"id": "x", "question": "q", "subject": "Space Law", "expected_authorities": [],'
        ' "must_abstain": true, "notes": "", "reviewed": false}',
        '{"id": "x", "question": "q", "subject": "Civil Law", "expected_authorities": [],'
        ' "must_abstain": false, "notes": "", "reviewed": false}',
        '{"id": "x", "question": "q", "subject": "Civil Law",'
        ' "expected_authorities": [{"db_id": "abc"}], "must_abstain": false,'
        ' "notes": "", "reviewed": false}',
        '{"id": "x", "question": "q", "subject": "Civil Law",'
        ' "expected_authorities": [{"statute": "Family Code"}], "must_abstain": false,'
        ' "notes": ""}',
    ],
)
def test_parser_rejects_malformed_lines(line: str) -> None:
    with pytest.raises(GoldenFormatError):
        parse_golden_line(line, "t:1")
