"""Tests for LIBERTASIAN OCR Service — Tesseract OCR extractor module.

Tests: _detect_language, _compute_confidence, _clean_ocr_text, extract_text.

Tesseract binary calls are mocked to avoid external dependency.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from src.ocr.extractor import (
    _clean_ocr_text,
    _compute_confidence,
    _detect_language,
    extract_text,
)
from src.schemas import OcrResponse


# ===========================================================================
# TestDetectLanguage
# ===========================================================================


class TestDetectLanguage:
    """Tests for _detect_language() — heuristic Filipino/English detection."""

    def test_english_text(self) -> None:
        """English legal text is detected as 'eng'."""
        text = (
            "The Supreme Court hereby grants the petition for certiorari. "
            "The lower court committed grave abuse of discretion amounting to "
            "lack or excess of jurisdiction. The decision is reversed and set aside. "
            "This is a purely English legal document with proper citations."
        )
        assert _detect_language(text) == "eng"

    def test_filipino_text(self) -> None:
        """Filipino text with common markers detected as 'fil'."""
        text = (
            "Ang mga nagsasalita sa wikang Filipino ay nag-uusap sa mga "
            "bagay na ito kung saan ang mga tao ay nagtatanong sa kanila. "
            "Ang mga ito ay para sa mga kabataan na nag-aaral ng batas "
            "at ang mga ito ay sa mga abogado rin."
        )
        assert _detect_language(text) == "fil"

    def test_short_text_defaults_english(self) -> None:
        """Text shorter than 50 chars defaults to 'eng'."""
        assert _detect_language("Ang mga") == "eng"

    def test_empty_text_defaults_english(self) -> None:
        """Empty text defaults to 'eng'."""
        assert _detect_language("") == "eng"

    def test_none_empty_strip(self) -> None:
        """Whitespace-only text defaults to 'eng'."""
        assert _detect_language("   \n\t   ") == "eng"

    def test_mixed_text_below_threshold(self) -> None:
        """Mixed text with few Filipino markers stays 'eng'."""
        text = (
            "The Court finds that the petitioner has failed to establish "
            "the required elements of the cause of action. The evidence "
            "presented is insufficient to support the allegations in the "
            "complaint filed before this honorable court."
        )
        assert _detect_language(text) == "eng"

    def test_samples_first_2000_chars(self) -> None:
        """Language detection only samples the first 2000 characters."""
        # English for first 2000 chars, then heavy Filipino
        english_part = "The court hereby decides " * 80  # ~2000 chars
        filipino_part = "ang mga sa ng kung para din rin nito niya " * 200
        text = english_part + filipino_part
        # Should detect as English because only first 2000 chars sampled
        assert _detect_language(text) == "eng"

    def test_whitespace_only_words_zero_count(self) -> None:
        """Text that splits to zero words defaults to 'eng'."""
        # 50+ chars of just spaces/newlines
        text = " " * 60
        assert _detect_language(text) == "eng"


# ===========================================================================
# TestComputeConfidence
# ===========================================================================


class TestComputeConfidence:
    """Tests for _compute_confidence() — weighted OCR confidence scoring."""

    def test_high_confidence_data(self) -> None:
        """All words with 95 confidence → ~0.95."""
        data = {
            "conf": ["95", "95", "95"],
            "text": ["DECISION", "The", "Court"],
        }
        result = _compute_confidence(data)
        assert result == pytest.approx(0.95, abs=0.01)

    def test_low_confidence_data(self) -> None:
        """All words with 30 confidence → 0.30."""
        data = {
            "conf": ["30", "30", "30"],
            "text": ["abc", "def", "ghi"],
        }
        result = _compute_confidence(data)
        assert result == pytest.approx(0.30, abs=0.01)

    def test_filters_negative_confidence(self) -> None:
        """Entries with conf=-1 (non-word) are excluded."""
        data = {
            "conf": ["-1", "90", "-1", "80", "-1"],
            "text": ["", "DECISION", "", "Court", ""],
        }
        result = _compute_confidence(data)
        # Only "DECISION" (90, weight=8) and "Court" (80, weight=5) count
        expected = (90 * 8 + 80 * 5) / (8 + 5) / 100.0
        assert result == pytest.approx(expected, abs=0.01)

    def test_empty_data(self) -> None:
        """Empty data returns 0.0."""
        assert _compute_confidence({"conf": [], "text": []}) == 0.0

    def test_missing_keys(self) -> None:
        """Missing keys return 0.0."""
        assert _compute_confidence({}) == 0.0

    def test_all_non_word_entries(self) -> None:
        """All -1 confidences return 0.0."""
        data = {
            "conf": ["-1", "-1", "-1"],
            "text": ["", "", ""],
        }
        assert _compute_confidence(data) == 0.0

    def test_word_length_weighting(self) -> None:
        """Longer words contribute more to the weighted average."""
        data = {
            "conf": ["100", "50"],
            "text": ["CONSTITUTIONAL", "a"],  # 14 chars vs 1 char
        }
        result = _compute_confidence(data)
        # Weighted: (100*14 + 50*1) / (14+1) = 1450/15 = 96.67 → 0.9667
        expected = (100 * 14 + 50 * 1) / (14 + 1) / 100.0
        assert result == pytest.approx(expected, abs=0.01)

    def test_empty_word_skipped(self) -> None:
        """Words that are empty after strip are excluded."""
        data = {
            "conf": ["90", "80"],
            "text": ["Hello", "   "],  # Second word is whitespace
        }
        result = _compute_confidence(data)
        assert result == pytest.approx(0.90, abs=0.01)

    def test_invalid_conf_value_skipped(self) -> None:
        """Non-integer confidence values are skipped."""
        data = {
            "conf": ["abc", "90", "xyz"],
            "text": ["Bad", "Good", "Bad"],
        }
        result = _compute_confidence(data)
        assert result == pytest.approx(0.90, abs=0.01)

    def test_result_clamped_and_rounded(self) -> None:
        """Result is clamped to [0.0, 1.0] and rounded to 4 decimal places."""
        data = {
            "conf": ["100", "100", "100"],
            "text": ["AAA", "BBB", "CCC"],
        }
        result = _compute_confidence(data)
        assert result == 1.0
        assert isinstance(result, float)

    def test_zero_confidence_words(self) -> None:
        """Words with 0 confidence are included (not filtered like -1)."""
        data = {
            "conf": ["0", "80"],
            "text": ["bad", "good"],
        }
        result = _compute_confidence(data)
        # (0*3 + 80*4) / (3+4) = 320/7 = 45.71 → 0.4571
        expected = (0 * 3 + 80 * 4) / (3 + 4) / 100.0
        assert result == pytest.approx(expected, abs=0.01)

    def test_text_list_shorter_than_conf(self) -> None:
        """When text list is shorter than conf, extra entries treated as empty."""
        data = {
            "conf": ["90", "80", "70"],
            "text": ["Hello"],  # Only one text entry
        }
        # Only first entry has a matching word
        result = _compute_confidence(data)
        assert result == pytest.approx(0.90, abs=0.01)


# ===========================================================================
# TestCleanOcrText
# ===========================================================================


class TestCleanOcrText:
    """Tests for _clean_ocr_text() — OCR artifact cleanup."""

    def test_normalizes_crlf(self) -> None:
        """Windows-style \\r\\n is converted to \\n."""
        result = _clean_ocr_text("Line 1\r\nLine 2\r\nLine 3")
        assert "\r" not in result
        assert result == "Line 1\nLine 2\nLine 3"

    def test_normalizes_cr(self) -> None:
        """Old Mac-style \\r is converted to \\n."""
        result = _clean_ocr_text("Line 1\rLine 2")
        assert result == "Line 1\nLine 2"

    def test_form_feed_replaced(self) -> None:
        """Form feed characters (\\f) are replaced with double newline."""
        result = _clean_ocr_text("Page 1\fPage 2")
        assert "\f" not in result
        assert "Page 1\n\nPage 2" == result

    def test_multiple_blank_lines_collapsed(self) -> None:
        """Three or more consecutive newlines collapse to double newline."""
        result = _clean_ocr_text("A\n\n\n\nB")
        assert result == "A\n\nB"

    def test_trailing_whitespace_removed(self) -> None:
        """Trailing whitespace on each line is stripped."""
        result = _clean_ocr_text("Hello   \nWorld   ")
        assert result == "Hello\nWorld"

    def test_leading_trailing_stripped(self) -> None:
        """Leading and trailing whitespace on the whole text is stripped."""
        result = _clean_ocr_text("  \n\nHello\n\n  ")
        assert result == "Hello"

    def test_empty_text(self) -> None:
        """Empty string returns empty string."""
        assert _clean_ocr_text("") == ""

    def test_none_text(self) -> None:
        """Falsy text returns empty string."""
        assert _clean_ocr_text("") == ""

    def test_preserves_double_newlines(self) -> None:
        """Exactly two consecutive newlines are preserved (paragraph breaks)."""
        result = _clean_ocr_text("Paragraph 1\n\nParagraph 2")
        assert result == "Paragraph 1\n\nParagraph 2"

    def test_complex_ocr_cleanup(self) -> None:
        """Combined OCR artifacts are cleaned in one pass."""
        messy = "  DECISION  \r\n\r\n\r\n\r\nThe Court   \ffinds that  \n\n\n\nWHEREFORE  "
        result = _clean_ocr_text(messy)
        assert "\r" not in result
        assert "\f" not in result
        # No runs of 3+ newlines
        assert "\n\n\n" not in result
        assert result.startswith("DECISION")
        assert result.endswith("WHEREFORE")


# ===========================================================================
# TestExtractText
# ===========================================================================


class TestExtractText:
    """Tests for extract_text() — full OCR pipeline with mocked Tesseract."""

    @patch("src.ocr.extractor.pytesseract")
    @patch("src.ocr.extractor.preprocess_for_ocr")
    def test_success_pipeline(
        self, mock_preprocess: MagicMock, mock_tess: MagicMock
    ) -> None:
        """Full pipeline: preprocess → Tesseract → confidence → language."""
        mock_preprocess.return_value = np.zeros((100, 200), dtype=np.uint8)
        mock_tess.image_to_data.return_value = {
            "conf": ["95", "90", "85"],
            "text": ["DECISION", "The", "Court"],
        }
        mock_tess.image_to_string.return_value = "DECISION\nThe Court hereby rules."
        mock_tess.Output.DICT = "dict"

        result = extract_text(b"fake_image_bytes", language="eng")

        assert isinstance(result, OcrResponse)
        assert "DECISION" in result.text
        assert result.confidence > 0
        assert result.word_count > 0
        assert result.language_detected == "eng"
        mock_preprocess.assert_called_once_with(b"fake_image_bytes")

    @patch("src.ocr.extractor.pytesseract")
    @patch("src.ocr.extractor.preprocess_for_ocr")
    def test_language_parameter_passed(
        self, mock_preprocess: MagicMock, mock_tess: MagicMock
    ) -> None:
        """Language parameter is forwarded to Tesseract config."""
        mock_preprocess.return_value = np.zeros((100, 200), dtype=np.uint8)
        mock_tess.image_to_data.return_value = {"conf": [], "text": []}
        mock_tess.image_to_string.return_value = ""
        mock_tess.Output.DICT = "dict"

        extract_text(b"fake", language="eng+fil")

        call_args = mock_tess.image_to_data.call_args
        config_str = call_args[1].get("config", call_args[0][1] if len(call_args[0]) > 1 else "")
        # Verify the language was included in the config string
        assert "eng+fil" in str(call_args)

    @patch("src.ocr.extractor.pytesseract")
    @patch("src.ocr.extractor.preprocess_for_ocr")
    def test_empty_ocr_result(
        self, mock_preprocess: MagicMock, mock_tess: MagicMock
    ) -> None:
        """Empty OCR result returns 0 confidence and 0 words."""
        mock_preprocess.return_value = np.zeros((100, 200), dtype=np.uint8)
        mock_tess.image_to_data.return_value = {"conf": ["-1"], "text": [""]}
        mock_tess.image_to_string.return_value = ""
        mock_tess.Output.DICT = "dict"

        result = extract_text(b"blank_image")
        assert result.confidence == 0.0
        assert result.word_count == 0
        assert result.text == ""

    @patch("src.ocr.extractor.pytesseract")
    @patch("src.ocr.extractor.preprocess_for_ocr")
    def test_filipino_text_detected(
        self, mock_preprocess: MagicMock, mock_tess: MagicMock
    ) -> None:
        """Filipino text is detected by language heuristic."""
        mock_preprocess.return_value = np.zeros((100, 200), dtype=np.uint8)
        mock_tess.image_to_data.return_value = {
            "conf": ["90"] * 10,
            "text": ["Ang", "mga", "nagsasalita", "sa", "wikang", "Filipino", "ay", "nag", "kung", "para"],
        }
        filipino_text = (
            "Ang mga nagsasalita sa wikang Filipino ay nag-uusap kung "
            "para sa mga kabataan ang mga bagay na ito sa mga abogado rin"
        )
        mock_tess.image_to_string.return_value = filipino_text
        mock_tess.Output.DICT = "dict"

        result = extract_text(b"fil_image")
        assert result.language_detected == "fil"

    @patch("src.ocr.extractor.pytesseract")
    @patch("src.ocr.extractor.preprocess_for_ocr")
    def test_text_is_cleaned(
        self, mock_preprocess: MagicMock, mock_tess: MagicMock
    ) -> None:
        """OCR text goes through _clean_ocr_text before returning."""
        mock_preprocess.return_value = np.zeros((100, 200), dtype=np.uint8)
        mock_tess.image_to_data.return_value = {"conf": ["90"], "text": ["Hello"]}
        mock_tess.image_to_string.return_value = "  Hello  \r\n\r\n\r\n\r\nWorld  "
        mock_tess.Output.DICT = "dict"

        result = extract_text(b"messy_image")
        assert "\r" not in result.text
        assert "\n\n\n" not in result.text
        assert result.text == "Hello\n\nWorld"

    @patch("src.ocr.extractor.pytesseract")
    @patch("src.ocr.extractor.preprocess_for_ocr")
    def test_word_count_from_cleaned_text(
        self, mock_preprocess: MagicMock, mock_tess: MagicMock
    ) -> None:
        """Word count is computed from the cleaned text."""
        mock_preprocess.return_value = np.zeros((100, 200), dtype=np.uint8)
        mock_tess.image_to_data.return_value = {"conf": ["90"] * 3, "text": ["A", "B", "C"]}
        mock_tess.image_to_string.return_value = "One Two Three"
        mock_tess.Output.DICT = "dict"

        result = extract_text(b"image")
        assert result.word_count == 3

    @patch("src.ocr.extractor.pytesseract")
    @patch("src.ocr.extractor.preprocess_for_ocr")
    def test_confidence_computed_from_data(
        self, mock_preprocess: MagicMock, mock_tess: MagicMock
    ) -> None:
        """Confidence is computed from Tesseract per-word data, not raw text."""
        mock_preprocess.return_value = np.zeros((100, 200), dtype=np.uint8)
        mock_tess.image_to_data.return_value = {
            "conf": ["80", "60"],
            "text": ["Word1", "Word2"],
        }
        mock_tess.image_to_string.return_value = "Word1 Word2"
        mock_tess.Output.DICT = "dict"

        result = extract_text(b"image")
        # Weighted: (80*5 + 60*5) / (5+5) = 700/10 = 70 → 0.70
        assert result.confidence == pytest.approx(0.70, abs=0.01)

    @patch("src.ocr.extractor.pytesseract")
    @patch("src.ocr.extractor.preprocess_for_ocr")
    def test_uses_oem3_psm3_config(
        self, mock_preprocess: MagicMock, mock_tess: MagicMock
    ) -> None:
        """Tesseract is called with OEM 3 (LSTM) and PSM 3 (auto) config."""
        mock_preprocess.return_value = np.zeros((100, 200), dtype=np.uint8)
        mock_tess.image_to_data.return_value = {"conf": [], "text": []}
        mock_tess.image_to_string.return_value = ""
        mock_tess.Output.DICT = "dict"

        extract_text(b"image", language="eng")

        # Check that config string contains --oem 3 and --psm 3
        data_call = mock_tess.image_to_data.call_args
        config = data_call[1].get("config", "")
        assert "--oem 3" in config
        assert "--psm 3" in config
        assert "-l eng" in config
