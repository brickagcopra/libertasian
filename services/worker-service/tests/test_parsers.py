"""Parser and metadata extractor tests (Phase 2 — Coverage Gaps).

Tests cover:
- HTML parser: content extraction, text cleaning, section segmentation
- Metadata extractor: GR No., dates, ponente, court, citation building
- Edge cases: empty HTML, minimal content, all section types
"""

from __future__ import annotations

import pytest

from src.parsers.html_parser import (
    _clean_text,
    _estimate_tokens,
    extract_sections,
    parse_legal_document,
)
from src.parsers.metadata_extractor import extract_metadata


# ---- HTML Parser: parse_legal_document ----


class TestParseLegalDocument:
    """Test HTML content extraction."""

    def test_strips_script_tags(self):
        html = '<html><body><script>alert("xss")</script><p>Legal text.</p></body></html>'
        result = parse_legal_document(html)
        assert "alert" not in result
        assert "Legal text." in result

    def test_strips_style_tags(self):
        html = "<html><body><style>.hidden{display:none}</style><p>Ruling.</p></body></html>"
        result = parse_legal_document(html)
        assert "hidden" not in result
        assert "Ruling." in result

    def test_strips_navigation(self):
        html = "<html><body><nav>Menu</nav><article>Decision content</article></body></html>"
        result = parse_legal_document(html)
        assert "Menu" not in result
        assert "Decision content" in result

    def test_strips_header_footer(self):
        html = (
            "<html><body>"
            "<header>Site Header</header>"
            "<div id='content'>Case ruling text here with enough content to be found.</div>"
            "<footer>Copyright</footer>"
            "</body></html>"
        )
        result = parse_legal_document(html)
        assert "Site Header" not in result
        assert "Copyright" not in result

    def test_finds_article_main_content(self):
        html = (
            "<html><body>"
            '<div class="sidebar">Side</div>'
            '<article>The Supreme Court of the Philippines hereby rules on the matter '
            "of jurisdiction in this case which involves complex legal questions "
            "about constitutional rights and obligations.</article>"
            "</body></html>"
        )
        result = parse_legal_document(html)
        assert "Supreme Court" in result

    def test_finds_role_main(self):
        html = (
            "<html><body>"
            '<div role="main">REPUBLIC OF THE PHILIPPINES SUPREME COURT '
            "This is the main decision content with substantial legal text "
            "about the ruling in the case. The court hereby decides...</div>"
            "</body></html>"
        )
        result = parse_legal_document(html)
        assert "REPUBLIC" in result

    def test_fallback_to_largest_div(self):
        html = (
            "<html><body>"
            "<div>Short.</div>"
            "<div>This is a much longer div that should be selected as the main content. "
            "It contains substantial legal text about a court decision regarding "
            "the constitutionality of a certain law. The petitioner argues that "
            "the respondent violated their rights under the constitution. "
            "The court hereby rules in favor of the petitioner. " * 10
            "</div>"
            "</body></html>"
        )
        result = parse_legal_document(html)
        assert "petitioner" in result

    def test_empty_html(self):
        result = parse_legal_document("<html><body></body></html>")
        assert isinstance(result, str)

    def test_minimal_content(self):
        result = parse_legal_document("<p>Brief note.</p>")
        assert "Brief note." in result


# ---- HTML Parser: _clean_text ----


class TestCleanText:
    """Test text cleaning utility."""

    def test_normalizes_crlf(self):
        result = _clean_text("line1\r\nline2\rline3")
        assert "\r" not in result
        assert "line1\nline2\nline3" == result

    def test_collapses_multiple_spaces(self):
        result = _clean_text("word1    word2\tword3")
        assert "word1 word2 word3" == result

    def test_collapses_excessive_newlines(self):
        result = _clean_text("para1\n\n\n\n\npara2")
        assert result == "para1\n\npara2"

    def test_strips_trailing_spaces(self):
        result = _clean_text("hello   \nworld")
        assert result == "hello\nworld"

    def test_strips_outer_whitespace(self):
        result = _clean_text("  \n  hello  \n  ")
        assert result == "hello"


# ---- HTML Parser: extract_sections ----


class TestExtractSections:
    """Test section segmentation for court decisions."""

    def test_single_body_when_no_headings(self):
        text = "This is a simple legal document with no section markers."
        sections = extract_sections(text)
        assert len(sections) == 1
        assert sections[0]["section_type"] == "body"
        assert sections[0]["ordering"] == 0

    def test_detects_facts_section(self):
        text = (
            "REPUBLIC OF THE PHILIPPINES\nSUPREME COURT\n\n"
            "THE FACTS\n"
            "The petitioner filed a complaint alleging that the respondent "
            "violated contractual obligations.\n\n"
            "THE ISSUES\n"
            "Whether the respondent is liable for breach of contract."
        )
        sections = extract_sections(text)
        types = [s["section_type"] for s in sections]
        assert "facts" in types
        assert "issues" in types

    def test_detects_ruling_section(self):
        text = (
            "THE FACTS\n"
            "Some facts here.\n\n"
            "THE COURT'S RULING\n"
            "The Court finds the petition meritorious.\n\n"
            "WHEREFORE\n"
            "The petition is GRANTED."
        )
        sections = extract_sections(text)
        types = [s["section_type"] for s in sections]
        assert "facts" in types
        assert "ruling" in types
        assert "dispositive" in types

    def test_detects_dispositive_wherefore(self):
        text = (
            "Discussion goes here.\n\n"
            "WHEREFORE\n"
            "Premises considered, the petition is hereby GRANTED."
        )
        sections = extract_sections(text)
        dispositive = [s for s in sections if s["section_type"] == "dispositive"]
        assert len(dispositive) == 1
        assert "GRANTED" in dispositive[0]["plain_text"]

    def test_detects_concurring_opinion(self):
        text = (
            "Main ruling text here.\n\n"
            "CONCURRING OPINION\n"
            "I concur with the majority but wish to add the following observations."
        )
        sections = extract_sections(text)
        types = [s["section_type"] for s in sections]
        assert "concurring" in types

    def test_detects_dissenting_opinion(self):
        text = (
            "Main ruling text here.\n\n"
            "DISSENTING OPINION\n"
            "I respectfully dissent from the majority ruling."
        )
        sections = extract_sections(text)
        types = [s["section_type"] for s in sections]
        assert "dissenting" in types

    def test_creates_preamble_when_content_before_first_section(self):
        text = (
            "REPUBLIC OF THE PHILIPPINES\nSUPREME COURT\n"
            "G.R. No. 123456\n"
            "PEOPLE OF THE PHILIPPINES, Plaintiff-Appellee\n"
            "vs.\n"
            "JOHN DOE, Accused-Appellant\n\n"
            "THE FACTS\n"
            "The accused was charged with robbery."
        )
        sections = extract_sections(text)
        # First section should be a headnote/preamble
        assert sections[0]["section_type"] == "headnote"
        assert sections[0]["section_label"] == "Preamble"

    def test_ordering_is_sequential(self):
        text = (
            "Preamble text goes here with enough content.\n" * 5 + "\n"
            "THE FACTS\n"
            "Facts text here.\n\n"
            "THE ISSUES\n"
            "Issues text here.\n\n"
            "OUR RULING\n"
            "Ruling text here.\n\n"
            "WHEREFORE\n"
            "Dispositive text here."
        )
        sections = extract_sections(text)
        orderings = [s["ordering"] for s in sections]
        assert orderings == sorted(orderings)

    def test_token_count_estimated(self):
        text = "THE FACTS\nThe petitioner filed a complaint with five words."
        sections = extract_sections(text)
        for section in sections:
            assert "token_count" in section
            assert section["token_count"] > 0

    def test_statute_sections(self):
        text = (
            "REPUBLIC ACT NO. 1234\n"
            "AN ACT PROVIDING FOR THE REGULATION OF SOMETHING\n\n"
            "SECTION 1. Short Title.\n"
            "This Act shall be known as the Something Act.\n\n"
            "SECTION 2. Declaration of Policy.\n"
            "It is the policy of the State to regulate something.\n\n"
            "SECTION 3. Definitions.\n"
            "For purposes of this Act, the following terms mean..."
        )
        sections = extract_sections(text, document_type="statute")
        # Should have preamble + at least 3 sections
        assert len(sections) >= 3
        labels = [s["section_label"] for s in sections if s["section_label"]]
        section_labels = [l for l in labels if l.startswith("SECTION")]
        assert len(section_labels) >= 2


# ---- HTML Parser: _estimate_tokens ----


class TestEstimateTokens:
    """Test token estimation."""

    def test_zero_words(self):
        assert _estimate_tokens(0) == 0

    def test_one_word(self):
        result = _estimate_tokens(1)
        assert result >= 1

    def test_hundred_words(self):
        result = _estimate_tokens(100)
        assert 100 <= result <= 200  # ~1.3x factor

    def test_ratio_roughly_1_3(self):
        result = _estimate_tokens(1000)
        assert result == 1300


# ---- Metadata Extractor ----


class TestExtractMetadata:
    """Test metadata extraction from legal document text."""

    def test_extracts_gr_no(self):
        text = "REPUBLIC OF THE PHILIPPINES\nSUPREME COURT\nG.R. No. 123456\nPeople v. Smith"
        meta = extract_metadata(text)
        assert meta["gr_no"] == "G.R. No. 123456"

    def test_extracts_am_no(self):
        text = "SUPREME COURT\nA.M. No. RTJ-12-1234\nRe: Complaint Against Judge"
        meta = extract_metadata(text)
        assert meta["gr_no"] == "A.M. No. RTJ-12-1234"

    def test_extracts_decision_date_long_format(self):
        text = "G.R. No. 123456\nPromulgated: January 15, 2024\n"
        meta = extract_metadata(text)
        assert meta["decision_date"] == "January 15, 2024"

    def test_extracts_decision_date_iso(self):
        text = "G.R. No. 123456\nDate: 2024-01-15\n"
        meta = extract_metadata(text)
        assert meta["decision_date"] == "2024-01-15"

    def test_extracts_court_supreme(self):
        text = "REPUBLIC OF THE PHILIPPINES\nSUPREME COURT\nG.R. No. 123456"
        meta = extract_metadata(text)
        assert meta["court"] == "Supreme Court"

    def test_extracts_court_of_appeals(self):
        text = "REPUBLIC OF THE PHILIPPINES\nCOURT OF APPEALS\nCA-G.R. No. 123456"
        meta = extract_metadata(text)
        assert meta["court"] == "Court of Appeals"

    def test_extracts_sandiganbayan(self):
        text = "REPUBLIC OF THE PHILIPPINES\nSANDIGANBAYAN\nCriminal Case No. 12345"
        meta = extract_metadata(text)
        assert meta["court"] == "Sandiganbayan"

    def test_extracts_ponente(self):
        text = "SUPREME COURT\nG.R. No. 123456\nPONENTE: Justice CARPIO\n"
        meta = extract_metadata(text)
        assert meta["ponente"] is not None
        assert "CARPIO" in meta["ponente"]

    def test_extracts_title_vs_pattern(self):
        text = "SUPREME COURT\nPeople of the Philippines vs. Juan Dela Cruz\nG.R. No. 123456"
        meta = extract_metadata(text)
        assert meta["title"] is not None
        assert "vs." in meta["title"]

    def test_builds_citation_text(self):
        text = "SUPREME COURT\nG.R. No. 123456\nJanuary 15, 2024\nPeople v. Smith"
        meta = extract_metadata(text)
        assert meta["citation_text"] is not None
        assert "G.R. No. 123456" in meta["citation_text"]
        assert "January 15, 2024" in meta["citation_text"]

    def test_no_metadata_returns_nulls(self):
        text = "Some random non-legal text without any patterns."
        meta = extract_metadata(text)
        assert meta["gr_no"] is None
        assert meta["decision_date"] is None
        assert meta["court"] is None

    def test_statute_extracts_ra_no(self):
        text = "REPUBLIC ACT NO. 7610\nAN ACT PROVIDING FOR STRONGER DETERRENCE"
        meta = extract_metadata(text, source_type="statute")
        assert meta["docket_no"] is not None
        assert "7610" in meta["docket_no"]

    def test_executive_order_extracts_eo_no(self):
        text = "EXECUTIVE ORDER NO. 292\nINSTITUTING THE ADMINISTRATIVE CODE"
        meta = extract_metadata(text, source_type="executive_order")
        assert meta["docket_no"] is not None
        assert "292" in meta["docket_no"]

    def test_citation_length_limit(self):
        """Citation text should not exceed 500 chars (DB VarChar limit)."""
        long_gr = "G.R. No. " + "1" * 600
        text = f"SUPREME COURT\n{long_gr}\nJanuary 15, 2024"
        meta = extract_metadata(text)
        if meta["citation_text"]:
            assert len(meta["citation_text"]) <= 500

    def test_uses_first_3000_chars_only(self):
        """Metadata extraction should only look at the header area."""
        header = "SUPREME COURT\nG.R. No. 111111\n"
        padding = "x " * 2000  # push past 3000 chars
        footer_gr = "G.R. No. 999999\n"
        text = header + padding + footer_gr
        meta = extract_metadata(text)
        # Should find the header GR No., not the footer one
        assert meta["gr_no"] == "G.R. No. 111111"

    def test_gr_no_variations(self):
        """Test various GR No. formatting."""
        variations = [
            ("G.R. No. 123456", "G.R. No. 123456"),
            ("GR No 123456", "G.R. No. 123456"),
            ("G.R. No. L-12345", "G.R. No. L-12345"),
        ]
        for input_text, expected in variations:
            text = f"SUPREME COURT\n{input_text}\n"
            meta = extract_metadata(text)
            assert meta["gr_no"] == expected, f"Failed for input: {input_text}"
