"""Tests for src.citations.extractor — Philippine legal citation extraction."""

from __future__ import annotations

import pytest

from src.citations.extractor import _normalize_number, extract_citations


class TestNormalizeNumber:
    """_normalize_number — whitespace collapsing and character normalization."""

    def test_whitespace_collapsing(self):
        assert _normalize_number("  123   456  ") == "123 456"

    def test_lowercase_l_to_uppercase(self):
        assert _normalize_number("l-12345") == "L-12345"

    def test_already_clean(self):
        assert _normalize_number("12345") == "12345"

    def test_mixed_spacing_and_l(self):
        assert _normalize_number(" l-123  456 ") == "L-123 456"


class TestExtractCitations:
    """extract_citations — regex-based citation pattern matching."""

    # ── Edge cases ────────────────────────────────────────────────────────

    def test_empty_string(self):
        result = extract_citations("")
        assert len(result.citations) == 0
        assert len(result.normalized_citations) == 0

    def test_short_text(self):
        result = extract_citations("Hello")
        assert len(result.citations) == 0

    def test_no_citations_in_text(self):
        text = "This is a regular paragraph with no legal citations whatsoever."
        result = extract_citations(text)
        assert len(result.citations) == 0

    # ── G.R. No. patterns ────────────────────────────────────────────────

    def test_gr_standard(self):
        result = extract_citations("The ruling in G.R. No. 123456 is binding.")
        assert len(result.citations) == 1
        assert "G.R. No." in result.normalized_citations[0]
        assert "123456" in result.normalized_citations[0]

    def test_gr_without_periods(self):
        result = extract_citations("See GR No 234567 for reference.")
        assert len(result.citations) == 1
        assert "G.R. No." in result.normalized_citations[0]

    def test_gr_l_prefix(self):
        result = extract_citations("In G.R. No. L-12345, the Court held...")
        assert len(result.citations) == 1
        assert "L-12345" in result.normalized_citations[0]

    def test_grn_format(self):
        result = extract_citations("Refer to GRN No. 345678.")
        assert len(result.citations) == 1
        assert "G.R. No." in result.normalized_citations[0]

    # ── Republic Act patterns ─────────────────────────────────────────────

    def test_ra_full_name(self):
        result = extract_citations("Republic Act No. 10175 defines cybercrime.")
        assert len(result.citations) == 1
        assert "R.A. No." in result.normalized_citations[0]
        assert "10175" in result.normalized_citations[0]

    def test_ra_abbreviation(self):
        result = extract_citations("Under R.A. No. 7610, child abuse is penalized.")
        assert len(result.citations) == 1
        assert "R.A. No." in result.normalized_citations[0]

    # ── Presidential Decree patterns ──────────────────────────────────────

    def test_pd_standard(self):
        result = extract_citations("P.D. No. 1529 governs land registration.")
        assert len(result.citations) == 1
        assert "P.D. No." in result.normalized_citations[0]

    def test_pd_full_name(self):
        result = extract_citations("Presidential Decree No. 957 protects subdivision buyers.")
        assert len(result.citations) == 1
        assert "P.D. No." in result.normalized_citations[0]

    # ── Executive Order patterns ──────────────────────────────────────────

    def test_eo_standard(self):
        result = extract_citations("E.O. No. 292 is the Administrative Code.")
        assert len(result.citations) == 1
        assert "E.O. No." in result.normalized_citations[0]

    # ── Batas Pambansa patterns ───────────────────────────────────────────

    def test_bp_blg(self):
        result = extract_citations("B.P. Blg. 22 penalizes bouncing checks.")
        assert len(result.citations) == 1
        assert "B.P. Blg." in result.normalized_citations[0]

    # ── Administrative Matter patterns ────────────────────────────────────

    def test_am_number(self):
        result = extract_citations("A.M. No. 03-1-09-SC amended the rules.")
        assert len(result.citations) == 1
        assert "A.M. No." in result.normalized_citations[0]

    # ── Reporter citations ────────────────────────────────────────────────

    def test_scra_citation(self):
        result = extract_citations("See 123 SCRA 456 for the ruling.")
        assert len(result.citations) == 1
        assert result.normalized_citations[0] == "123 SCRA 456"

    def test_phil_reports(self):
        result = extract_citations("Cited in 50 Phil. 100.")
        assert len(result.citations) == 1
        assert result.normalized_citations[0] == "50 Phil. 100"

    # ── Multiple citations and deduplication ──────────────────────────────

    def test_multiple_citations_in_text(self):
        text = (
            "Under R.A. No. 10175 and P.D. No. 1529, as affirmed in "
            "G.R. No. 199422 (123 SCRA 456), the law is clear."
        )
        result = extract_citations(text)
        assert len(result.citations) >= 3

    def test_deduplication_same_citation(self):
        text = "G.R. No. 123456 was cited. Later, G.R. No. 123456 was cited again."
        result = extract_citations(text)
        assert len(result.citations) == 1

    def test_different_citations_not_deduplicated(self):
        text = "G.R. No. 111111 and G.R. No. 222222 are distinct."
        result = extract_citations(text)
        assert len(result.citations) == 2

    def test_raw_and_normalized_same_length(self):
        text = "R.A. No. 7610 and P.D. No. 957 and E.O. No. 292."
        result = extract_citations(text)
        assert len(result.citations) == len(result.normalized_citations)
