"""LIBERTASIAN OCR Service — Request/response Pydantic models."""

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    service: str
    version: str


class QualityScoreRequest(BaseModel):
    """Request to score image quality. Image data sent as multipart form."""

    model_config = ConfigDict(strict=True)


class QualityMetrics(BaseModel):
    """Individual quality metric scores."""

    blur_score: float = Field(ge=0.0, le=1.0, description="Sharpness score (1.0 = very sharp)")
    resolution_score: float = Field(
        ge=0.0, le=1.0, description="Resolution adequacy (1.0 = excellent)"
    )
    contrast_score: float = Field(
        ge=0.0, le=1.0, description="Contrast quality (1.0 = high contrast)"
    )
    brightness_score: float = Field(
        ge=0.0, le=1.0, description="Brightness adequacy (1.0 = well-lit)"
    )


class QualityScoreResponse(BaseModel):
    """Response from quality scoring endpoint."""

    overall_score: float = Field(ge=0.0, le=1.0, description="Weighted overall quality score")
    metrics: QualityMetrics
    is_acceptable: bool = Field(description="True if score >= reject threshold (0.2)")
    needs_warning: bool = Field(description="True if score < warn threshold (0.4)")
    recommendation: str = Field(description="Human-readable recommendation")


class OcrRequest(BaseModel):
    """Request to run OCR on an image. Image data sent as multipart form."""

    language: str = Field(default="eng", description="Tesseract language code")

    model_config = ConfigDict(strict=True)


class OcrResponse(BaseModel):
    """Response from OCR extraction."""

    text: str = Field(description="Extracted text content")
    confidence: float = Field(ge=0.0, le=1.0, description="Average OCR confidence")
    word_count: int = Field(ge=0, description="Number of words extracted")
    language_detected: str = Field(description="Detected language code")


class ClassificationResult(BaseModel):
    """Document classification result."""

    document_type: str = Field(description="Classified document type")
    confidence: float = Field(ge=0.0, le=1.0, description="Classification confidence")


class CitationExtractionResult(BaseModel):
    """Extracted citations from OCR text."""

    citations: list[str] = Field(description="List of extracted citation strings")
    normalized_citations: list[str] = Field(description="Normalized citation forms")


class PdfPageResult(BaseModel):
    """Extraction result for a single PDF page."""

    page_number: int = Field(ge=1, description="1-indexed page number")
    text: str = Field(description="Extracted text for this page")
    word_count: int = Field(ge=0, description="Number of words on this page")
    is_ocr: bool = Field(description="True if page needed OCR (image-only)")


class PdfExtractionResponse(BaseModel):
    """Response from PDF text extraction."""

    pages: list[PdfPageResult] = Field(description="Per-page extraction results")
    total_text: str = Field(description="Combined text from all pages")
    total_word_count: int = Field(ge=0, description="Total words across all pages")
    total_pages: int = Field(ge=0, description="Total number of pages in the PDF")
    confidence: float = Field(ge=0.0, le=1.0, description="Overall extraction confidence")
    language_detected: str = Field(description="Detected language code")
    has_text_layer: bool = Field(description="True if PDF has a native text layer")
