"""LIBERTASIAN OCR Service — Image quality scoring.

Analyzes image quality via blur detection (Laplacian variance), resolution
adequacy, contrast analysis, and brightness. Returns a 0.0–1.0 overall score.
"""

from io import BytesIO

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image

Image.MAX_IMAGE_PIXELS = 100_000_000  # 100MP limit, matches Sharp config on NestJS side

from ..config import settings
from ..schemas import QualityMetrics, QualityScoreResponse


def _load_image_as_cv2(image_bytes: bytes) -> NDArray[np.uint8]:
    """Load image bytes into an OpenCV numpy array."""
    pil_image = Image.open(BytesIO(image_bytes))
    if pil_image.mode == "RGBA":
        pil_image = pil_image.convert("RGB")
    return np.array(pil_image, dtype=np.uint8)


def _compute_blur_score(gray: NDArray[np.uint8]) -> float:
    """Compute sharpness via Laplacian variance.

    Higher variance = sharper image. We normalize to 0.0–1.0 using a sigmoid-like
    mapping where a Laplacian variance of ~500 maps to ~0.9.
    """
    laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    # Sigmoid normalization: score = var / (var + k) where k controls midpoint
    k = 200.0
    return min(laplacian_var / (laplacian_var + k), 1.0)


def _compute_resolution_score(height: int, width: int) -> float:
    """Score resolution adequacy for OCR.

    Target: at least 1500px on the longer side for good OCR quality.
    Below 500px is very poor for document OCR.
    """
    longer_side = max(height, width)
    if longer_side >= 1500:
        return 1.0
    if longer_side <= 300:
        return 0.0
    # Linear interpolation between 300 and 1500
    return (longer_side - 300) / 1200.0


def _compute_contrast_score(gray: NDArray[np.uint8]) -> float:
    """Score contrast via standard deviation of pixel intensities.

    Good document scans have high contrast between text (dark) and background (light).
    Std dev of ~60+ indicates good contrast for document images.
    """
    std_dev = float(np.std(gray))
    if std_dev >= 60.0:
        return 1.0
    if std_dev <= 10.0:
        return 0.0
    return (std_dev - 10.0) / 50.0


def _compute_brightness_score(gray: NDArray[np.uint8]) -> float:
    """Score brightness adequacy.

    Ideal mean brightness for document scans is 150–200 (well-lit white paper
    with dark text). Too dark (<80) or too bright (>240) hurts OCR.
    """
    mean_brightness = float(np.mean(gray))
    if 130.0 <= mean_brightness <= 210.0:
        return 1.0
    if mean_brightness < 50.0 or mean_brightness > 245.0:
        return 0.0
    # Score degrades linearly outside ideal range
    if mean_brightness < 130.0:
        return (mean_brightness - 50.0) / 80.0
    return (245.0 - mean_brightness) / 35.0


def score_image_quality(image_bytes: bytes) -> QualityScoreResponse:
    """Analyze image quality and return a comprehensive score.

    Weights:
    - Blur (sharpness): 40% — most critical for OCR
    - Resolution: 25% — needed for small text recognition
    - Contrast: 25% — text vs background distinction
    - Brightness: 10% — supplementary factor
    """
    img = _load_image_as_cv2(image_bytes)
    height, width = img.shape[:2]

    # Convert to grayscale for analysis
    if len(img.shape) == 3:
        gray: NDArray[np.uint8] = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    else:
        gray = img

    blur = _compute_blur_score(gray)
    resolution = _compute_resolution_score(height, width)
    contrast = _compute_contrast_score(gray)
    brightness = _compute_brightness_score(gray)

    # Weighted overall score
    overall = (blur * 0.40) + (resolution * 0.25) + (contrast * 0.25) + (brightness * 0.10)
    overall = round(min(max(overall, 0.0), 1.0), 4)

    is_acceptable = overall >= settings.quality_reject_threshold
    needs_warning = overall < settings.quality_warn_threshold

    if not is_acceptable:
        recommendation = (
            "Image quality is too low for reliable OCR. "
            "Please retake with better lighting, hold the camera steady, "
            "and ensure the document fills the frame."
        )
    elif needs_warning:
        recommendation = (
            "Image quality is marginal. OCR results may be incomplete. "
            "Consider retaking with better lighting or a closer distance."
        )
    else:
        recommendation = "Image quality is acceptable for OCR processing."

    return QualityScoreResponse(
        overall_score=overall,
        metrics=QualityMetrics(
            blur_score=round(blur, 4),
            resolution_score=round(resolution, 4),
            contrast_score=round(contrast, 4),
            brightness_score=round(brightness, 4),
        ),
        is_acceptable=is_acceptable,
        needs_warning=needs_warning,
        recommendation=recommendation,
    )
