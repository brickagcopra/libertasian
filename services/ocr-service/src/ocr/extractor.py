"""LIBERTASIAN OCR Service — Tesseract OCR wrapper with confidence scoring.

Wraps pytesseract to extract text from preprocessed document images,
compute per-word and overall confidence scores, and detect language.
"""

import re

import pytesseract
from numpy.typing import NDArray
import numpy as np

from ..config import settings
from ..preprocessing.enhance import preprocess_for_ocr
from ..schemas import OcrResponse


# Configure Tesseract binary path
pytesseract.pytesseract.tesseract_cmd = settings.tesseract_cmd


def _detect_language(text: str) -> str:
    """Simple heuristic language detection for Philippine legal documents.

    Checks for common Filipino/Tagalog markers. Defaults to 'eng' since
    Philippine legal documents are predominantly in English.
    """
    filipino_markers = [
        r"\bng\b",
        r"\bsa\b",
        r"\bat\b",
        r"\bang\b",
        r"\bmga\b",
        r"\bnito\b",
        r"\bniya\b",
        r"\bito\b",
        r"\bkung\b",
        r"\bpara\b",
        r"\bdin\b",
        r"\brin\b",
    ]

    if not text or len(text.strip()) < 50:
        return "eng"

    # Sample first 2000 chars for detection
    sample = text[:2000].lower()
    filipino_count = 0
    for pattern in filipino_markers:
        filipino_count += len(re.findall(pattern, sample))

    word_count = len(sample.split())
    if word_count == 0:
        return "eng"

    filipino_ratio = filipino_count / word_count
    if filipino_ratio > 0.10:
        return "fil"
    return "eng"


def _compute_confidence(data: dict[str, list[str]]) -> float:
    """Compute overall OCR confidence from Tesseract per-word data.

    Filters out non-word entries (confidence = -1) and computes the
    weighted mean confidence, where weights are word lengths.

    Returns:
        Confidence score normalized to 0.0–1.0.
    """
    confidences: list[float] = []
    weights: list[int] = []

    conf_list = data.get("conf", [])
    text_list = data.get("text", [])

    for i, conf_str in enumerate(conf_list):
        try:
            conf = int(conf_str)
        except (ValueError, TypeError):
            continue

        # Tesseract uses -1 for non-word entries (whitespace, etc.)
        if conf < 0:
            continue

        word = text_list[i].strip() if i < len(text_list) else ""
        if not word:
            continue

        confidences.append(float(conf))
        weights.append(max(len(word), 1))

    if not confidences:
        return 0.0

    # Weighted mean: longer words contribute more to overall score
    total_weight = sum(weights)
    weighted_sum = sum(c * w for c, w in zip(confidences, weights))
    mean_conf = weighted_sum / total_weight

    # Normalize from 0–100 to 0.0–1.0
    return round(min(max(mean_conf / 100.0, 0.0), 1.0), 4)


def extract_text(image_bytes: bytes, language: str = "eng") -> OcrResponse:
    """Extract text from an image using Tesseract OCR.

    Pipeline: preprocess image → run Tesseract → compute confidence →
    detect language → return structured result.

    Args:
        image_bytes: Raw image file bytes.
        language: Tesseract language code (e.g., 'eng', 'fil', 'eng+fil').

    Returns:
        OcrResponse with extracted text, confidence, word count, and language.
    """
    # Preprocess for optimal OCR quality
    preprocessed = preprocess_for_ocr(image_bytes)

    # Run Tesseract with page segmentation mode 3 (fully automatic)
    # --oem 3 = LSTM neural net OCR engine (default, best accuracy)
    custom_config = f"--oem 3 --psm 3 -l {language}"

    # Get detailed per-word data for confidence scoring
    data: dict[str, list[str]] = pytesseract.image_to_data(
        preprocessed,
        config=custom_config,
        output_type=pytesseract.Output.DICT,
    )

    # Extract full text
    text = pytesseract.image_to_string(
        preprocessed,
        config=custom_config,
    )

    # Clean up extracted text
    text = _clean_ocr_text(text)

    # Compute confidence
    confidence = _compute_confidence(data)

    # Count words
    word_count = len(text.split()) if text.strip() else 0

    # Detect language
    language_detected = _detect_language(text)

    return OcrResponse(
        text=text,
        confidence=confidence,
        word_count=word_count,
        language_detected=language_detected,
    )


def _clean_ocr_text(text: str) -> str:
    """Clean up OCR-extracted text.

    - Remove excessive whitespace
    - Fix common OCR artifacts
    - Normalize line breaks
    """
    if not text:
        return ""

    # Normalize line endings
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    # Remove form feed characters
    text = text.replace("\f", "\n\n")

    # Collapse multiple blank lines into double newline
    text = re.sub(r"\n{3,}", "\n\n", text)

    # Remove trailing whitespace on each line
    lines = [line.rstrip() for line in text.split("\n")]
    text = "\n".join(lines)

    # Strip leading/trailing whitespace
    text = text.strip()

    return text
