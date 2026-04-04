"""LIBERTASIAN OCR Service — PDF text extraction using PyMuPDF.

Extracts text page-by-page from PDF files, preserving page boundaries.
For digital PDFs with a text layer, extraction is fast and high-confidence.
For image-only pages, falls back to Tesseract OCR via the existing OCR module.
"""

import re

import fitz  # PyMuPDF

from ..config import settings
from ..ocr.extractor import extract_text as ocr_extract_text
from ..schemas import PdfExtractionResponse, PdfPageResult


def _detect_language(text: str) -> str:
    """Simple heuristic language detection for Philippine legal documents."""
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
    ]

    if not text or len(text.strip()) < 50:
        return "eng"

    sample = text[:2000].lower()
    filipino_count = 0
    for pattern in filipino_markers:
        filipino_count += len(re.findall(pattern, sample))

    word_count = len(sample.split())
    if word_count == 0:
        return "eng"

    filipino_ratio = filipino_count / word_count
    return "fil" if filipino_ratio > 0.10 else "eng"


def _clean_page_text(text: str) -> str:
    """Clean extracted page text."""
    if not text:
        return ""

    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    lines = [line.rstrip() for line in text.split("\n")]
    return "\n".join(lines).strip()


def extract_pdf_text(pdf_bytes: bytes) -> PdfExtractionResponse:
    """Extract text from a PDF file, page by page.

    Uses PyMuPDF for native text extraction on digital PDFs.
    Falls back to Tesseract OCR for image-only pages.

    Args:
        pdf_bytes: Raw PDF file bytes.

    Returns:
        PdfExtractionResponse with per-page results and aggregate stats.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    total_pages = len(doc)
    pages: list[PdfPageResult] = []
    has_text_layer = False
    text_layer_pages = 0

    for page_num in range(total_pages):
        page = doc[page_num]
        text = page.get_text("text")
        text = _clean_page_text(text)
        is_ocr = False

        # If page has very little text, it may be image-only — try OCR
        word_count = len(text.split()) if text.strip() else 0
        if word_count < settings.pdf_min_words_per_page:
            # Render page to image and run OCR
            try:
                pix = page.get_pixmap(dpi=settings.pdf_render_dpi)
                image_bytes = pix.tobytes("png")
                ocr_result = ocr_extract_text(image_bytes, "eng")
                ocr_text = ocr_result.text.strip()
                ocr_words = len(ocr_text.split()) if ocr_text else 0

                # Use OCR result if it extracted more text
                if ocr_words > word_count:
                    text = ocr_text
                    word_count = ocr_words
                    is_ocr = True
            except Exception:
                # If OCR fails, keep whatever text we got from PyMuPDF
                pass
        else:
            text_layer_pages += 1

        if not is_ocr and word_count >= settings.pdf_min_words_per_page:
            has_text_layer = True

        pages.append(
            PdfPageResult(
                page_number=page_num + 1,
                text=text,
                word_count=word_count,
                is_ocr=is_ocr,
            )
        )

    doc.close()

    # Aggregate
    total_text = "\n\n".join(p.text for p in pages if p.text)
    total_word_count = sum(p.word_count for p in pages)

    # Confidence: 1.0 for fully digital PDFs, lower for mixed/OCR
    if total_pages == 0:
        confidence = 0.0
    elif has_text_layer and text_layer_pages == total_pages:
        confidence = 1.0
    else:
        # Blend: digital pages get 1.0, OCR pages get 0.7
        ocr_pages = sum(1 for p in pages if p.is_ocr)
        digital_pages = total_pages - ocr_pages
        confidence = round(
            (digital_pages * 1.0 + ocr_pages * 0.7) / total_pages, 4
        )

    language_detected = _detect_language(total_text)

    return PdfExtractionResponse(
        pages=pages,
        total_text=total_text,
        total_word_count=total_word_count,
        total_pages=total_pages,
        confidence=confidence,
        language_detected=language_detected,
        has_text_layer=has_text_layer,
    )
