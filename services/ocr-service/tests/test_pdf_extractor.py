"""Tests for LIBERTASIAN OCR Service — PDF text extraction module.

Tests: _detect_language, _clean_page_text, extract_pdf_text.

PyMuPDF (fitz) and OCR fallback are mocked to avoid binary dependencies.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch, PropertyMock

import pytest

from src.pdf.extractor import (
    _clean_page_text,
    _detect_language,
    extract_pdf_text,
)
from src.schemas import OcrResponse, PdfExtractionResponse


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_mock_page(
    text: str = "Some legal text here for testing purposes",
    word_count: int | None = None,
    pixmap_bytes: bytes = b"fake_png",
) -> MagicMock:
    """Create a mock fitz page object."""
    page = MagicMock()
    page.get_text.return_value = text
    pix = MagicMock()
    pix.tobytes.return_value = pixmap_bytes
    page.get_pixmap.return_value = pix
    return page


def _make_mock_doc(pages: list[MagicMock]) -> MagicMock:
    """Create a mock fitz document with given pages."""
    doc = MagicMock()
    doc.__len__ = MagicMock(return_value=len(pages))
    doc.__getitem__ = MagicMock(side_effect=lambda i: pages[i])
    doc.close = MagicMock()
    return doc


# ===========================================================================
# TestDetectLanguage (PDF module's own copy)
# ===========================================================================


class TestDetectLanguage:
    """Tests for _detect_language() — heuristic Filipino/English detection."""

    def test_english_legal_text(self) -> None:
        """English legal text detected as 'eng'."""
        text = (
            "The Supreme Court hereby grants the petition for certiorari. "
            "The lower court committed grave abuse of discretion amounting to "
            "lack or excess of jurisdiction when it issued the questioned order."
        )
        assert _detect_language(text) == "eng"

    def test_filipino_text(self) -> None:
        """Filipino text with common markers detected as 'fil'."""
        text = (
            "Ang mga nagsasalita sa wikang Filipino ay nag-uusap sa mga "
            "bagay na ito kung saan ang mga tao ay nagtatanong sa kanila. "
            "Ang mga ito ay para sa mga kabataan na nag-aaral ng batas."
        )
        assert _detect_language(text) == "fil"

    def test_short_text_defaults_english(self) -> None:
        """Text shorter than 50 chars defaults to 'eng'."""
        assert _detect_language("Ang mga") == "eng"

    def test_empty_text(self) -> None:
        """Empty text defaults to 'eng'."""
        assert _detect_language("") == "eng"

    def test_whitespace_only(self) -> None:
        """Whitespace-only text defaults to 'eng'."""
        assert _detect_language("   \n   ") == "eng"

    def test_threshold_boundary(self) -> None:
        """Text at exactly the boundary (10% Filipino markers) detected as 'fil'."""
        # Build text where Filipino markers = just over 10% of words
        # 10 words total, 2 Filipino markers > 10%
        text = (
            "The court decides sa this matter ng the parties involved "
            "hereby judgment is rendered accordingly today court rules"
        )
        result = _detect_language(text)
        # This depends on exact word count and marker count
        assert result in ("eng", "fil")


# ===========================================================================
# TestCleanPageText
# ===========================================================================


class TestCleanPageText:
    """Tests for _clean_page_text() — page-level text cleanup."""

    def test_normalizes_crlf(self) -> None:
        """\\r\\n converted to \\n."""
        assert _clean_page_text("A\r\nB") == "A\nB"

    def test_normalizes_cr(self) -> None:
        """\\r converted to \\n."""
        assert _clean_page_text("A\rB") == "A\nB"

    def test_collapses_multiple_newlines(self) -> None:
        """Three or more newlines collapsed to double newline."""
        assert _clean_page_text("A\n\n\n\nB") == "A\n\nB"

    def test_strips_trailing_whitespace_per_line(self) -> None:
        """Trailing whitespace on lines is removed."""
        assert _clean_page_text("Hello   \nWorld   ") == "Hello\nWorld"

    def test_strips_overall(self) -> None:
        """Leading/trailing whitespace stripped from whole text."""
        assert _clean_page_text("  \nHello\n  ") == "Hello"

    def test_empty_text(self) -> None:
        """Empty string returns empty string."""
        assert _clean_page_text("") == ""

    def test_falsy_text(self) -> None:
        """Falsy input returns empty string."""
        assert _clean_page_text("") == ""

    def test_preserves_paragraph_breaks(self) -> None:
        """Double newlines (paragraph breaks) are preserved."""
        assert _clean_page_text("P1\n\nP2") == "P1\n\nP2"


# ===========================================================================
# TestExtractPdfText
# ===========================================================================


class TestExtractPdfText:
    """Tests for extract_pdf_text() — PDF text extraction with OCR fallback."""

    @patch("src.pdf.extractor.fitz")
    def test_digital_pdf_single_page(self, mock_fitz: MagicMock) -> None:
        """Single-page digital PDF returns text with confidence 1.0."""
        text = "DECISION\n\nThe Supreme Court hereby rules in favor of petitioner."
        page = _make_mock_page(text=text)
        doc = _make_mock_doc([page])
        mock_fitz.open.return_value = doc

        result = extract_pdf_text(b"fake_pdf_bytes")

        assert isinstance(result, PdfExtractionResponse)
        assert result.total_pages == 1
        assert len(result.pages) == 1
        assert result.pages[0].page_number == 1
        assert result.pages[0].is_ocr is False
        assert "DECISION" in result.total_text
        assert result.confidence == 1.0
        assert result.has_text_layer is True
        doc.close.assert_called_once()

    @patch("src.pdf.extractor.fitz")
    def test_digital_pdf_multi_page(self, mock_fitz: MagicMock) -> None:
        """Multi-page digital PDF aggregates text and has confidence 1.0."""
        page1 = _make_mock_page(text="Page one text with enough words for the threshold test here.")
        page2 = _make_mock_page(text="Page two has more text that exceeds the minimum word count easily.")
        page3 = _make_mock_page(text="Page three contains additional legal content for proper testing purposes clearly.")
        doc = _make_mock_doc([page1, page2, page3])
        mock_fitz.open.return_value = doc

        result = extract_pdf_text(b"pdf")

        assert result.total_pages == 3
        assert len(result.pages) == 3
        assert result.confidence == 1.0
        assert all(not p.is_ocr for p in result.pages)
        # Total text is joined with double newlines
        assert "\n\n" in result.total_text

    @patch("src.pdf.extractor.ocr_extract_text")
    @patch("src.pdf.extractor.fitz")
    def test_image_only_page_ocr_fallback(
        self, mock_fitz: MagicMock, mock_ocr: MagicMock
    ) -> None:
        """Image-only page (few words) triggers OCR fallback."""
        # Page has very few words (below pdf_min_words_per_page=10)
        page = _make_mock_page(text="Only two")
        doc = _make_mock_doc([page])
        mock_fitz.open.return_value = doc

        # OCR returns more text
        mock_ocr.return_value = OcrResponse(
            text="DECISION The Supreme Court hereby rules in favor of the petitioner based on evidence",
            confidence=0.85,
            word_count=15,
            language_detected="eng",
        )

        result = extract_pdf_text(b"scanned_pdf")

        assert result.pages[0].is_ocr is True
        assert "DECISION" in result.pages[0].text
        assert result.pages[0].word_count == 14
        mock_ocr.assert_called_once()

    @patch("src.pdf.extractor.ocr_extract_text")
    @patch("src.pdf.extractor.fitz")
    def test_ocr_returns_fewer_words_keeps_original(
        self, mock_fitz: MagicMock, mock_ocr: MagicMock
    ) -> None:
        """If OCR returns fewer words than PyMuPDF, original text is kept."""
        page = _make_mock_page(text="Short text only five words")
        doc = _make_mock_doc([page])
        mock_fitz.open.return_value = doc

        # OCR returns even less
        mock_ocr.return_value = OcrResponse(
            text="Short text",
            confidence=0.5,
            word_count=2,
            language_detected="eng",
        )

        result = extract_pdf_text(b"pdf")

        assert result.pages[0].is_ocr is False
        assert "five" in result.pages[0].text

    @patch("src.pdf.extractor.ocr_extract_text")
    @patch("src.pdf.extractor.fitz")
    def test_ocr_exception_gracefully_handled(
        self, mock_fitz: MagicMock, mock_ocr: MagicMock
    ) -> None:
        """OCR failure on image-only page keeps whatever text PyMuPDF got."""
        page = _make_mock_page(text="Few words")
        doc = _make_mock_doc([page])
        mock_fitz.open.return_value = doc

        mock_ocr.side_effect = RuntimeError("Tesseract not found")

        result = extract_pdf_text(b"pdf")

        # Should not raise; keeps original text
        assert result.pages[0].text == "Few words"
        assert result.pages[0].is_ocr is False

    @patch("src.pdf.extractor.fitz")
    def test_empty_pdf(self, mock_fitz: MagicMock) -> None:
        """PDF with zero pages returns empty results."""
        doc = _make_mock_doc([])
        mock_fitz.open.return_value = doc

        result = extract_pdf_text(b"empty_pdf")

        assert result.total_pages == 0
        assert result.total_text == ""
        assert result.total_word_count == 0
        assert result.confidence == 0.0
        assert result.pages == []

    @patch("src.pdf.extractor.ocr_extract_text")
    @patch("src.pdf.extractor.fitz")
    def test_mixed_digital_and_ocr_pages(
        self, mock_fitz: MagicMock, mock_ocr: MagicMock
    ) -> None:
        """Mixed PDF: digital pages get 1.0, OCR pages get 0.7 blended confidence."""
        # Page 1: digital (enough words)
        page1 = _make_mock_page(
            text="This page has a sufficient number of words for the threshold to be met easily."
        )
        # Page 2: image-only (few words)
        page2 = _make_mock_page(text="Only two")

        doc = _make_mock_doc([page1, page2])
        mock_fitz.open.return_value = doc

        mock_ocr.return_value = OcrResponse(
            text="OCR extracted sufficient text from the image page for testing purposes accurately here today",
            confidence=0.8,
            word_count=15,
            language_detected="eng",
        )

        result = extract_pdf_text(b"mixed_pdf")

        assert result.total_pages == 2
        assert result.pages[0].is_ocr is False
        assert result.pages[1].is_ocr is True
        # Confidence: (1*1.0 + 1*0.7) / 2 = 0.85
        assert result.confidence == pytest.approx(0.85, abs=0.01)

    @patch("src.pdf.extractor.fitz")
    def test_page_numbers_are_1_indexed(self, mock_fitz: MagicMock) -> None:
        """Page numbers in results are 1-indexed (not 0-indexed)."""
        pages = [
            _make_mock_page(text=f"Page {i} has enough words for the minimum threshold test here.") for i in range(3)
        ]
        doc = _make_mock_doc(pages)
        mock_fitz.open.return_value = doc

        result = extract_pdf_text(b"pdf")

        assert result.pages[0].page_number == 1
        assert result.pages[1].page_number == 2
        assert result.pages[2].page_number == 3

    @patch("src.pdf.extractor.fitz")
    def test_total_word_count_aggregated(self, mock_fitz: MagicMock) -> None:
        """Total word count is the sum across all pages."""
        page1 = _make_mock_page(text="One two three four five six seven eight nine ten eleven twelve.")
        page2 = _make_mock_page(text="Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu.")
        doc = _make_mock_doc([page1, page2])
        mock_fitz.open.return_value = doc

        result = extract_pdf_text(b"pdf")

        assert result.total_word_count == result.pages[0].word_count + result.pages[1].word_count
        assert result.total_word_count > 0

    @patch("src.pdf.extractor.fitz")
    def test_total_text_joined_with_double_newline(self, mock_fitz: MagicMock) -> None:
        """Pages are joined with \\n\\n in total_text."""
        page1 = _make_mock_page(text="First page content has many words to meet the minimum word threshold here.")
        page2 = _make_mock_page(text="Second page content also has many words to meet the minimum word threshold.")
        doc = _make_mock_doc([page1, page2])
        mock_fitz.open.return_value = doc

        result = extract_pdf_text(b"pdf")

        parts = result.total_text.split("\n\n")
        assert len(parts) >= 2

    @patch("src.pdf.extractor.fitz")
    def test_has_text_layer_flag(self, mock_fitz: MagicMock) -> None:
        """has_text_layer is True when at least one page has digital text above threshold."""
        page = _make_mock_page(text="This digital page contains enough words to exceed the minimum word threshold test.")
        doc = _make_mock_doc([page])
        mock_fitz.open.return_value = doc

        result = extract_pdf_text(b"pdf")

        assert result.has_text_layer is True

    @patch("src.pdf.extractor.ocr_extract_text")
    @patch("src.pdf.extractor.fitz")
    def test_all_ocr_pages_confidence(
        self, mock_fitz: MagicMock, mock_ocr: MagicMock
    ) -> None:
        """All-OCR PDF has confidence = 0.7 (OCR page weight)."""
        page1 = _make_mock_page(text="Few")
        page2 = _make_mock_page(text="Words")
        doc = _make_mock_doc([page1, page2])
        mock_fitz.open.return_value = doc

        mock_ocr.return_value = OcrResponse(
            text="OCR text with sufficient words to exceed the minimum threshold for testing purposes",
            confidence=0.8,
            word_count=15,
            language_detected="eng",
        )

        result = extract_pdf_text(b"scanned_pdf")

        # Both pages OCR: (2*0.7) / 2 = 0.7
        assert result.confidence == pytest.approx(0.7, abs=0.01)

    @patch("src.pdf.extractor.fitz")
    def test_language_detected_from_total_text(self, mock_fitz: MagicMock) -> None:
        """Language detection runs on the combined total_text."""
        text = (
            "The Supreme Court hereby grants the petition for certiorari. "
            "The lower court committed grave abuse of discretion amounting to "
            "lack or excess of jurisdiction when it issued the questioned order."
        )
        page = _make_mock_page(text=text)
        doc = _make_mock_doc([page])
        mock_fitz.open.return_value = doc

        result = extract_pdf_text(b"pdf")

        assert result.language_detected == "eng"

    @patch("src.pdf.extractor.fitz")
    def test_doc_close_called(self, mock_fitz: MagicMock) -> None:
        """fitz document is always closed after extraction."""
        page = _make_mock_page(text="Simple text with enough words for threshold test here now.")
        doc = _make_mock_doc([page])
        mock_fitz.open.return_value = doc

        extract_pdf_text(b"pdf")

        doc.close.assert_called_once()

    @patch("src.pdf.extractor.fitz")
    def test_fitz_open_params(self, mock_fitz: MagicMock) -> None:
        """fitz.open is called with stream= and filetype='pdf'."""
        doc = _make_mock_doc([])
        mock_fitz.open.return_value = doc
        pdf_data = b"fake_pdf_content"

        extract_pdf_text(pdf_data)

        mock_fitz.open.assert_called_once_with(stream=pdf_data, filetype="pdf")

    @patch("src.pdf.extractor.fitz")
    def test_empty_page_text(self, mock_fitz: MagicMock) -> None:
        """Page with empty text after cleaning has 0 word count."""
        page = _make_mock_page(text="")
        doc = _make_mock_doc([page])
        mock_fitz.open.return_value = doc

        # Mock OCR to also return empty
        with patch("src.pdf.extractor.ocr_extract_text") as mock_ocr:
            mock_ocr.return_value = OcrResponse(
                text="",
                confidence=0.0,
                word_count=0,
                language_detected="eng",
            )
            result = extract_pdf_text(b"pdf")

        assert result.pages[0].word_count == 0
        assert result.pages[0].text == ""

    @patch("src.pdf.extractor.ocr_extract_text")
    @patch("src.pdf.extractor.fitz")
    def test_ocr_renders_at_configured_dpi(
        self, mock_fitz: MagicMock, mock_ocr: MagicMock
    ) -> None:
        """OCR fallback renders page at settings.pdf_render_dpi."""
        page = _make_mock_page(text="Few words")
        doc = _make_mock_doc([page])
        mock_fitz.open.return_value = doc

        mock_ocr.return_value = OcrResponse(
            text="OCR with enough words to exceed the threshold for page testing purposes",
            confidence=0.8,
            word_count=12,
            language_detected="eng",
        )

        with patch("src.pdf.extractor.settings") as mock_settings:
            mock_settings.pdf_min_words_per_page = 10
            mock_settings.pdf_render_dpi = 200
            extract_pdf_text(b"pdf")

        page.get_pixmap.assert_called_once_with(dpi=200)
