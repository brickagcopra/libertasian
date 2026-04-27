"""Parity check: ocr-service extractor still matches the canonical set
that worker-service's vendored copy is asserted against.

If this test breaks while worker-service's identical test stays green
(or vice versa), the two regex sets have diverged and one needs to be
updated to match.
"""

from __future__ import annotations

import pytest

from src.citations.extractor import extract_citations

from .citations_parity_fixtures import PARITY_CASES


@pytest.mark.parametrize(
    "label,text,expected",
    PARITY_CASES,
    ids=[c[0] for c in PARITY_CASES],
)
def test_parity_cases_match_canonical_set(
    label: str, text: str, expected: set[str]
) -> None:
    result = extract_citations(text)
    assert set(result.normalized_citations) == expected, (
        f"parity case {label!r} drifted"
    )
