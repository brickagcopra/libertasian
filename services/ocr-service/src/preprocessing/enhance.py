"""LIBERTASIAN OCR Service — Image preprocessing for OCR.

Applies deskew, denoise, contrast enhancement, and binarization to improve
OCR accuracy on camera-scanned legal documents.
"""

from io import BytesIO

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image

from ..config import settings


def _load_image(image_bytes: bytes) -> NDArray[np.uint8]:
    """Load image bytes into an OpenCV BGR numpy array."""
    pil_image = Image.open(BytesIO(image_bytes))
    if pil_image.mode == "RGBA":
        pil_image = pil_image.convert("RGB")
    elif pil_image.mode == "L":
        # Already grayscale — convert to BGR for consistency
        pil_image = pil_image.convert("RGB")
    rgb_array: NDArray[np.uint8] = np.array(pil_image, dtype=np.uint8)
    return cv2.cvtColor(rgb_array, cv2.COLOR_RGB2BGR)


def _to_grayscale(img: NDArray[np.uint8]) -> NDArray[np.uint8]:
    """Convert BGR image to grayscale."""
    if len(img.shape) == 2:
        return img
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)  # type: ignore[return-value]


def deskew(gray: NDArray[np.uint8], max_angle: float = 15.0) -> NDArray[np.uint8]:
    """Correct rotation/skew in scanned document images.

    Uses Hough line detection to find the dominant text line angle and
    rotates the image to correct it.

    Args:
        gray: Grayscale image array.
        max_angle: Maximum correction angle in degrees. Larger skews are ignored.

    Returns:
        Deskewed grayscale image.
    """
    # Edge detection for line finding
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)

    # Detect lines using probabilistic Hough transform
    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=100,
        minLineLength=gray.shape[1] // 4,  # min line = 1/4 image width
        maxLineGap=10,
    )

    if lines is None or len(lines) == 0:
        return gray

    # Calculate angles of detected lines
    angles: list[float] = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        dx = float(x2 - x1)
        dy = float(y2 - y1)
        if abs(dx) < 1.0:
            continue
        angle = np.degrees(np.arctan2(dy, dx))
        # Only consider near-horizontal lines (text lines)
        if abs(angle) <= max_angle:
            angles.append(angle)

    if not angles:
        return gray

    # Use median angle for robustness against outliers
    median_angle = float(np.median(angles))

    # Skip correction for very small angles (< 0.5 degrees)
    if abs(median_angle) < 0.5:
        return gray

    # Rotate image to correct skew
    h, w = gray.shape[:2]
    center = (w // 2, h // 2)
    rotation_matrix = cv2.getRotationMatrix2D(center, median_angle, 1.0)
    rotated: NDArray[np.uint8] = cv2.warpAffine(
        gray,
        rotation_matrix,
        (w, h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )
    return rotated


def denoise(gray: NDArray[np.uint8]) -> NDArray[np.uint8]:
    """Apply noise reduction optimized for document text.

    Uses Non-Local Means denoising which preserves edges (text boundaries)
    while reducing noise from camera sensors.
    """
    denoised: NDArray[np.uint8] = cv2.fastNlMeansDenoising(
        gray,
        h=10,  # filter strength — higher removes more noise but blurs more
        templateWindowSize=7,
        searchWindowSize=21,
    )
    return denoised


def enhance_contrast(gray: NDArray[np.uint8]) -> NDArray[np.uint8]:
    """Enhance contrast using CLAHE (Contrast Limited Adaptive Histogram Equalization).

    CLAHE works well on unevenly lit document scans (common with camera captures)
    by applying histogram equalization on small tiles rather than the whole image.
    """
    clahe = cv2.createCLAHE(
        clipLimit=2.0,
        tileGridSize=(8, 8),
    )
    enhanced: NDArray[np.uint8] = clahe.apply(gray)
    return enhanced


def adaptive_binarize(gray: NDArray[np.uint8]) -> NDArray[np.uint8]:
    """Convert to binary (black and white) using adaptive thresholding.

    Adaptive thresholding handles uneven lighting across the document
    better than global thresholding. Essential for camera scans.
    """
    binary: NDArray[np.uint8] = cv2.adaptiveThreshold(
        gray,
        maxValue=255,
        adaptiveMethod=cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        thresholdType=cv2.THRESH_BINARY,
        blockSize=31,  # size of neighborhood for threshold calculation
        C=15,  # constant subtracted from mean
    )
    return binary


def resize_for_ocr(
    img: NDArray[np.uint8],
    max_width: int | None = None,
    max_height: int | None = None,
) -> NDArray[np.uint8]:
    """Resize image if it exceeds maximum dimensions, preserving aspect ratio.

    Args:
        img: Input image.
        max_width: Maximum width. Defaults to config setting.
        max_height: Maximum height. Defaults to config setting.

    Returns:
        Resized image (or original if within bounds).
    """
    max_w = max_width or settings.max_image_width
    max_h = max_height or settings.max_image_height
    h, w = img.shape[:2]

    if w <= max_w and h <= max_h:
        return img

    # Calculate scale factor preserving aspect ratio
    scale = min(max_w / w, max_h / h)
    new_w = int(w * scale)
    new_h = int(h * scale)

    resized: NDArray[np.uint8] = cv2.resize(
        img, (new_w, new_h), interpolation=cv2.INTER_AREA
    )
    return resized


def preprocess_for_ocr(image_bytes: bytes) -> NDArray[np.uint8]:
    """Full preprocessing pipeline for OCR.

    Applies the complete pipeline: load → grayscale → resize → deskew →
    denoise → enhance contrast → binarize.

    Args:
        image_bytes: Raw image file bytes.

    Returns:
        Preprocessed grayscale image ready for Tesseract.
    """
    img = _load_image(image_bytes)
    gray = _to_grayscale(img)
    gray = resize_for_ocr(gray)
    gray = deskew(gray)
    gray = denoise(gray)
    gray = enhance_contrast(gray)
    binary = adaptive_binarize(gray)
    return binary
