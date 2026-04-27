"""Worker-side citation extractor tests — parity with ocr-service.

Pure unit tests against the vendored extractor; no DB, no Celery.
"""

from __future__ import annotations

import pytest

from src.citations.extractor import (
    citation_type_for,
    extract_citation_matches,
    extract_citations,
)

from .fixtures import PARITY_CASES


@pytest.mark.parametrize("label,text,expected", PARITY_CASES, ids=[c[0] for c in PARITY_CASES])
def test_parity_cases_match_canonical_set(
    label: str, text: str, expected: set[str]
) -> None:
    result = extract_citations(text)
    assert set(result.normalized_citations) == expected, (
        f"parity case {label!r} drifted"
    )


def test_extract_citation_matches_returns_offsets() -> None:
    text = "The ruling in G.R. No. 123456 is binding."
    matches = extract_citation_matches(text)
    assert len(matches) == 1
    m = matches[0]
    assert m.normalized == "G.R. No. 123456"
    assert m.citation_type == "case"
    assert text[m.start : m.end].strip().endswith("123456")


def test_dedup_by_normalized_form() -> None:
    text = "G.R. No. 100 and again GR No 100 — also G.R. No. 100."
    matches = extract_citation_matches(text)
    assert len(matches) == 1
    assert matches[0].normalized == "G.R. No. 100"


def test_citation_type_classification() -> None:
    assert citation_type_for("G.R. No. 123456") == "case"
    assert citation_type_for("A.M. No. 02-11-10") == "case"
    assert citation_type_for("R.A. No. 9165") == "statute"
    assert citation_type_for("P.D. No. 1083") == "statute"
    assert citation_type_for("E.O. No. 12") == "regulation"
    assert citation_type_for("123 SCRA 456") == "reporter"
    assert citation_type_for("Article 1234") == "other"


def test_short_text_returns_empty() -> None:
    assert extract_citations("").normalized_citations == []
    assert extract_citations("hi").normalized_citations == []
