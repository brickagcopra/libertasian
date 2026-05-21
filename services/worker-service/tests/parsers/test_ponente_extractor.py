"""Regression coverage for the ponente field in metadata_extractor.

Prod sample showed ~834 rows persisted as "D E C I S I O N <NAME>" or
full case captions ending in "D E C I S I O N <NAME>". The extractor
now (a) matches the spaced-out decision/resolution header pattern and
(b) rejects strings that are clearly case captions or header noise.

These tests live in their own module so they are collectable independent
of unrelated pre-existing syntax issues in the broader test_parsers.py
file (a `* 10` literal-concat that fails ast.parse on collection).
"""

from __future__ import annotations

from src.parsers.metadata_extractor import (
    _clean_justice_name,
    extract_metadata,
)


def test_extracts_decision_header_simple() -> None:
    text = (
        "SUPREME COURT\nG.R. No. 123456\nPeople vs. Smith\n\n"
        "D E C I S I O N\n\nPERALTA, J.:\n\nThe petitioner..."
    )
    meta = extract_metadata(text)
    assert meta["ponente"] == "PERALTA"


def test_extracts_decision_header_no_jot() -> None:
    """Match even when the justice's name has no trailing ', J.:' suffix."""
    text = "SUPREME COURT\nG.R. No. 1\n\nD E C I S I O N\nPERALTA\n\nThe..."
    meta = extract_metadata(text)
    assert meta["ponente"] == "PERALTA"


def test_decision_header_with_jr_suffix() -> None:
    text = "G.R. No. 1\n\nD E C I S I O N\n\nVILLARAMA, JR\n\nFacts..."
    meta = extract_metadata(text)
    assert meta["ponente"] == "VILLARAMA, JR."


def test_decision_header_after_full_caption() -> None:
    """The extractor must NOT return the case caption fragment."""
    text = (
        "PEOPLE OF THE PHILIPPINES, plaintiff-appellee, vs. JUAN DELA CRUZ, "
        "accused-appellant.\nG.R. No. 200000\nJanuary 15, 2024\n\n"
        "D E C I S I O N\n\nROSARIO, J.:\n\nFacts..."
    )
    meta = extract_metadata(text)
    assert meta["ponente"] == "ROSARIO"


def test_decision_header_with_comma_petitioner_caption() -> None:
    """Bug sample from prod: FRANCIS LEO ANTONIO MARCOS, PETITIONER, VS.
    COMELEC, RESPONDENT. D E C I S I O N SINGH"""
    text = (
        "FRANCIS LEO ANTONIO MARCOS, PETITIONER, VS. COMMISSION ON ELECTIONS, "
        "RESPONDENT.\nG.R. No. 250000\nJanuary 15, 2024\n\n"
        "D E C I S I O N\n\nSINGH, J.:\n\nThis case..."
    )
    meta = extract_metadata(text)
    assert meta["ponente"] == "SINGH"


def test_resolution_header_recognised() -> None:
    text = "G.R. No. 1\n\nR E S O L U T I O N\n\nCAGUIOA, J.:\n\nFacts..."
    meta = extract_metadata(text)
    assert meta["ponente"] == "CAGUIOA"


def test_rejects_decision_header_noise() -> None:
    """If only the literal noise is captured, the cleaner must drop it
    rather than persist 'D E C I S I O N PERALTA'."""
    assert _clean_justice_name("D E C I S I O N PERALTA") is None
    assert _clean_justice_name("DECISION MENDOZA") is None
    assert _clean_justice_name("R E S O L U T I O N CAGUIOA") is None


def test_rejects_caption_fragments() -> None:
    assert _clean_justice_name("PEOPLE OF THE PHILIPPINES vs. SMITH") is None
    assert _clean_justice_name("MARCOS, PETITIONER VS. COMELEC") is None
    assert _clean_justice_name("REPUBLIC OF THE PHILIPPINES") is None


def test_rejects_overlong_strings() -> None:
    too_long = "A" * 80
    assert _clean_justice_name(too_long) is None


def test_keeps_valid_short_names() -> None:
    assert _clean_justice_name("CARPIO") == "CARPIO"
    assert _clean_justice_name("Velasco, Jr.") == "Velasco, JR."
    # Trailing ", J." is stripped (it's the regex artifact).
    assert _clean_justice_name("LEONEN, J.") == "LEONEN"


def test_mixed_case_velasco_jr_matches() -> None:
    """Loosened JUSTICE_PATTERN allows mixed-case names that the strict
    all-caps version missed."""
    text = "SUPREME COURT\nG.R. No. 1\n\nVelasco, Jr., J.:\n\nFacts..."
    meta = extract_metadata(text)
    assert meta["ponente"] is not None
    assert "Velasco" in meta["ponente"]
