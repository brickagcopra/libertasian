"""Tests for LIBERTASIAN OCR Service — Image preprocessing module.

Tests: _load_image, _to_grayscale, deskew, denoise, enhance_contrast,
adaptive_binarize, resize_for_ocr, preprocess_for_ocr.

All tests use synthetic numpy/PIL images to avoid external file dependencies.
"""

from __future__ import annotations

from io import BytesIO
from unittest.mock import patch

import cv2
import numpy as np
import pytest
from numpy.typing import NDArray
from PIL import Image

from src.preprocessing.enhance import (
    _load_image,
    _to_grayscale,
    adaptive_binarize,
    deskew,
    denoise,
    enhance_contrast,
    preprocess_for_ocr,
    resize_for_ocr,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_jpeg_bytes(
    width: int = 200,
    height: int = 100,
    mode: str = "RGB",
    color: tuple | int = (128, 128, 128),
) -> bytes:
    """Create a JPEG image in memory and return raw bytes."""
    img = Image.new(mode, (width, height), color)
    buf = BytesIO()
    if mode == "RGBA":
        # Convert to RGB for JPEG (JPEG doesn't support alpha)
        img = img.convert("RGB")
    elif mode == "L":
        pass  # Grayscale JPEG is fine
    img.save(buf, format="JPEG", quality=95)
    buf.seek(0)
    return buf.read()


def _make_png_bytes(
    width: int = 200,
    height: int = 100,
    mode: str = "RGBA",
    color: tuple | int = (128, 128, 128, 255),
) -> bytes:
    """Create a PNG image in memory and return raw bytes."""
    img = Image.new(mode, (width, height), color)
    buf = BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.read()


def _gray_image(h: int = 100, w: int = 200, value: int = 128) -> NDArray[np.uint8]:
    """Create a uniform grayscale image."""
    return np.full((h, w), value, dtype=np.uint8)


def _bgr_image(h: int = 100, w: int = 200) -> NDArray[np.uint8]:
    """Create a BGR image with distinguishable channels."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:, :, 0] = 50   # Blue
    img[:, :, 1] = 100  # Green
    img[:, :, 2] = 150  # Red
    return img


# ===========================================================================
# TestLoadImage
# ===========================================================================


class TestLoadImage:
    """Tests for _load_image() — converts raw image bytes to OpenCV BGR array."""

    def test_load_rgb_jpeg(self) -> None:
        """RGB JPEG is loaded as BGR array with 3 channels."""
        data = _make_jpeg_bytes(200, 100, "RGB", (100, 150, 200))
        result = _load_image(data)
        assert result.ndim == 3
        assert result.shape == (100, 200, 3)
        assert result.dtype == np.uint8

    def test_load_rgba_png(self) -> None:
        """RGBA PNG is converted to BGR (alpha channel stripped)."""
        data = _make_png_bytes(150, 80, "RGBA", (100, 150, 200, 128))
        result = _load_image(data)
        assert result.ndim == 3
        assert result.shape[2] == 3  # BGR, no alpha

    def test_load_grayscale_jpeg(self) -> None:
        """Grayscale JPEG is converted to BGR for consistency."""
        data = _make_jpeg_bytes(120, 60, "L", 128)
        result = _load_image(data)
        assert result.ndim == 3
        assert result.shape == (60, 120, 3)

    def test_output_is_bgr_not_rgb(self) -> None:
        """Verify the output is BGR (OpenCV convention), not RGB."""
        # Create an image with distinct R, G, B values
        img = Image.new("RGB", (10, 10), (255, 0, 0))  # Pure red in RGB
        buf = BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        result = _load_image(buf.read())
        # In BGR, pure red should be [0, 0, 255]
        assert result[0, 0, 2] == 255  # Red in BGR position
        assert result[0, 0, 0] == 0    # Blue in BGR position


# ===========================================================================
# TestToGrayscale
# ===========================================================================


class TestToGrayscale:
    """Tests for _to_grayscale() — converts BGR to single-channel grayscale."""

    def test_bgr_to_gray(self) -> None:
        """BGR image is converted to single-channel grayscale."""
        bgr = _bgr_image(80, 120)
        result = _to_grayscale(bgr)
        assert result.ndim == 2
        assert result.shape == (80, 120)

    def test_already_grayscale_passthrough(self) -> None:
        """Grayscale image (2D) is returned unchanged."""
        gray = _gray_image(50, 70, 200)
        result = _to_grayscale(gray)
        assert result.ndim == 2
        np.testing.assert_array_equal(result, gray)

    def test_output_dtype(self) -> None:
        """Output dtype is uint8."""
        bgr = _bgr_image()
        result = _to_grayscale(bgr)
        assert result.dtype == np.uint8


# ===========================================================================
# TestDeskew
# ===========================================================================


class TestDeskew:
    """Tests for deskew() — corrects rotation using Hough line detection."""

    def test_no_lines_detected_returns_unchanged(self) -> None:
        """Uniform image with no lines returns the same image."""
        gray = _gray_image(100, 200, 128)
        result = deskew(gray)
        np.testing.assert_array_equal(result, gray)

    def test_preserves_shape(self) -> None:
        """Output has the same shape as input."""
        gray = _gray_image(150, 300)
        result = deskew(gray)
        assert result.shape == gray.shape

    def test_small_angle_skipped(self) -> None:
        """Angles less than 0.5 degrees are not corrected."""
        # Create a blank image with a near-horizontal line
        gray = np.full((200, 400), 255, dtype=np.uint8)
        # Draw a perfectly horizontal black line
        cv2.line(gray, (50, 100), (350, 100), 0, 2)
        cv2.line(gray, (50, 120), (350, 120), 0, 2)
        cv2.line(gray, (50, 140), (350, 140), 0, 2)
        result = deskew(gray)
        # With horizontal lines (0 angle), result should be unchanged
        np.testing.assert_array_equal(result, gray)

    def test_custom_max_angle(self) -> None:
        """max_angle parameter limits the correction range."""
        gray = _gray_image(100, 200)
        # With max_angle=0, even detected lines won't be corrected
        result = deskew(gray, max_angle=0.0)
        np.testing.assert_array_equal(result, gray)

    def test_output_dtype_preserved(self) -> None:
        """Output maintains uint8 dtype."""
        gray = _gray_image(100, 200)
        result = deskew(gray)
        assert result.dtype == np.uint8


# ===========================================================================
# TestDenoise
# ===========================================================================


class TestDenoise:
    """Tests for denoise() — Non-Local Means denoising for documents."""

    def test_preserves_shape(self) -> None:
        """Output has the same dimensions as input."""
        gray = _gray_image(100, 200)
        result = denoise(gray)
        assert result.shape == gray.shape

    def test_output_dtype(self) -> None:
        """Output is uint8."""
        gray = _gray_image(100, 200)
        result = denoise(gray)
        assert result.dtype == np.uint8

    def test_reduces_noise(self) -> None:
        """Denoising reduces pixel-level variance on noisy image."""
        rng = np.random.default_rng(42)
        noisy = np.clip(
            128 + rng.normal(0, 30, (100, 200)).astype(np.int16),
            0, 255
        ).astype(np.uint8)
        result = denoise(noisy)
        # Denoised image should have lower variance than the noisy one
        assert float(np.std(result)) < float(np.std(noisy))

    def test_uniform_image_unchanged(self) -> None:
        """Uniform image has no noise to remove; should be nearly unchanged."""
        gray = _gray_image(100, 200, 128)
        result = denoise(gray)
        # May have tiny floating-point differences, but should be very close
        diff = np.abs(result.astype(np.int16) - gray.astype(np.int16))
        assert np.mean(diff) < 1.0


# ===========================================================================
# TestEnhanceContrast
# ===========================================================================


class TestEnhanceContrast:
    """Tests for enhance_contrast() — CLAHE contrast enhancement."""

    def test_preserves_shape(self) -> None:
        """Output has the same dimensions as input."""
        gray = _gray_image(100, 200)
        result = enhance_contrast(gray)
        assert result.shape == gray.shape

    def test_output_dtype(self) -> None:
        """Output is uint8."""
        gray = _gray_image(100, 200)
        result = enhance_contrast(gray)
        assert result.dtype == np.uint8

    def test_output_range(self) -> None:
        """Output values stay within 0-255."""
        rng = np.random.default_rng(42)
        gray = rng.integers(0, 256, (100, 200), dtype=np.uint8)
        result = enhance_contrast(gray)
        assert np.min(result) >= 0
        assert np.max(result) <= 255

    def test_low_contrast_image_enhanced(self) -> None:
        """Low-contrast image gets wider histogram after CLAHE."""
        # Create low-contrast image (narrow value range)
        gray = np.clip(
            np.random.default_rng(42).integers(100, 130, (100, 200)),
            0, 255
        ).astype(np.uint8)
        result = enhance_contrast(gray)
        # Enhanced image should have greater range (more contrast)
        input_range = int(np.max(gray)) - int(np.min(gray))
        output_range = int(np.max(result)) - int(np.min(result))
        assert output_range >= input_range


# ===========================================================================
# TestAdaptiveBinarize
# ===========================================================================


class TestAdaptiveBinarize:
    """Tests for adaptive_binarize() — binary thresholding for OCR."""

    def test_output_is_binary(self) -> None:
        """Output contains only 0 and 255 (black and white)."""
        rng = np.random.default_rng(42)
        gray = rng.integers(0, 256, (100, 200), dtype=np.uint8)
        result = adaptive_binarize(gray)
        unique_vals = set(np.unique(result))
        assert unique_vals.issubset({0, 255})

    def test_preserves_shape(self) -> None:
        """Output has the same dimensions as input."""
        gray = _gray_image(100, 200)
        result = adaptive_binarize(gray)
        assert result.shape == gray.shape

    def test_output_dtype(self) -> None:
        """Output is uint8."""
        gray = _gray_image(100, 200)
        result = adaptive_binarize(gray)
        assert result.dtype == np.uint8

    def test_dark_text_on_light_bg(self) -> None:
        """Dark text on light background produces white background, dark text."""
        # Create image with dark center (text) on light bg
        gray = np.full((100, 200), 240, dtype=np.uint8)  # Light background
        gray[30:70, 60:140] = 20  # Dark text region
        result = adaptive_binarize(gray)
        # Output should be binary
        unique_vals = set(np.unique(result))
        assert unique_vals.issubset({0, 255})
        # Background areas should be mostly white (255)
        assert np.mean(result[0:10, 0:10]) > 200


# ===========================================================================
# TestResizeForOcr
# ===========================================================================


class TestResizeForOcr:
    """Tests for resize_for_ocr() — resize oversized images for OCR."""

    def test_within_bounds_no_change(self) -> None:
        """Image within max dimensions is returned unchanged."""
        gray = _gray_image(100, 200)
        result = resize_for_ocr(gray, max_width=2048, max_height=2048)
        np.testing.assert_array_equal(result, gray)

    def test_exceeds_width_resized(self) -> None:
        """Image wider than max_width is resized down."""
        gray = _gray_image(500, 3000)
        result = resize_for_ocr(gray, max_width=1500, max_height=2048)
        assert result.shape[1] <= 1500

    def test_exceeds_height_resized(self) -> None:
        """Image taller than max_height is resized down."""
        gray = _gray_image(3000, 500)
        result = resize_for_ocr(gray, max_width=2048, max_height=1500)
        assert result.shape[0] <= 1500

    def test_aspect_ratio_preserved(self) -> None:
        """Aspect ratio is maintained after resize."""
        gray = _gray_image(600, 1200)  # 2:1 aspect ratio
        result = resize_for_ocr(gray, max_width=600, max_height=600)
        h, w = result.shape[:2]
        ratio = w / h
        assert abs(ratio - 2.0) < 0.1

    def test_uses_config_defaults(self) -> None:
        """When no max values provided, uses settings defaults (2048)."""
        gray = _gray_image(100, 200)
        result = resize_for_ocr(gray)
        # Image is within 2048x2048, should be unchanged
        np.testing.assert_array_equal(result, gray)

    def test_both_dimensions_exceed(self) -> None:
        """When both dimensions exceed, scale factor uses the smaller ratio."""
        gray = _gray_image(4000, 6000)
        result = resize_for_ocr(gray, max_width=2000, max_height=2000)
        h, w = result.shape[:2]
        assert w <= 2000
        assert h <= 2000

    def test_output_dtype(self) -> None:
        """Output maintains uint8 dtype after resize."""
        gray = _gray_image(3000, 3000)
        result = resize_for_ocr(gray, max_width=1000, max_height=1000)
        assert result.dtype == np.uint8

    def test_exact_boundary(self) -> None:
        """Image exactly at max dimensions is not resized."""
        gray = _gray_image(2048, 2048)
        result = resize_for_ocr(gray, max_width=2048, max_height=2048)
        assert result.shape == (2048, 2048)


# ===========================================================================
# TestPreprocessForOcr
# ===========================================================================


class TestPreprocessForOcr:
    """Tests for preprocess_for_ocr() — full preprocessing pipeline."""

    def test_returns_binary_image(self) -> None:
        """Full pipeline output is a binary (black/white) image."""
        data = _make_jpeg_bytes(300, 200, "RGB", (128, 128, 128))
        result = preprocess_for_ocr(data)
        unique_vals = set(np.unique(result))
        assert unique_vals.issubset({0, 255})

    def test_returns_2d_array(self) -> None:
        """Pipeline output is single-channel (grayscale/binary)."""
        data = _make_jpeg_bytes(300, 200, "RGB")
        result = preprocess_for_ocr(data)
        assert result.ndim == 2

    def test_output_dtype(self) -> None:
        """Output is uint8."""
        data = _make_jpeg_bytes(300, 200, "RGB")
        result = preprocess_for_ocr(data)
        assert result.dtype == np.uint8

    def test_rgba_input(self) -> None:
        """RGBA input is processed without error."""
        data = _make_png_bytes(300, 200, "RGBA")
        result = preprocess_for_ocr(data)
        assert result.ndim == 2
        assert result.dtype == np.uint8

    def test_grayscale_input(self) -> None:
        """Grayscale input is processed without error."""
        data = _make_jpeg_bytes(300, 200, "L", 128)
        result = preprocess_for_ocr(data)
        assert result.ndim == 2

    def test_large_image_gets_resized(self) -> None:
        """Image exceeding max dimensions is resized during pipeline."""
        data = _make_jpeg_bytes(4000, 3000, "RGB")
        result = preprocess_for_ocr(data)
        h, w = result.shape[:2]
        assert w <= 2048
        assert h <= 2048

    def test_pipeline_step_order(self) -> None:
        """Verify the pipeline calls steps in correct order."""
        data = _make_jpeg_bytes(200, 100, "RGB")
        call_order: list[str] = []

        orig_resize = resize_for_ocr
        orig_deskew = deskew
        orig_denoise = denoise
        orig_enhance = enhance_contrast
        orig_binarize = adaptive_binarize

        with (
            patch("src.preprocessing.enhance.resize_for_ocr", side_effect=lambda *a, **kw: (call_order.append("resize"), orig_resize(*a, **kw))[1]),
            patch("src.preprocessing.enhance.deskew", side_effect=lambda *a, **kw: (call_order.append("deskew"), orig_deskew(*a, **kw))[1]),
            patch("src.preprocessing.enhance.denoise", side_effect=lambda *a, **kw: (call_order.append("denoise"), orig_denoise(*a, **kw))[1]),
            patch("src.preprocessing.enhance.enhance_contrast", side_effect=lambda *a, **kw: (call_order.append("enhance"), orig_enhance(*a, **kw))[1]),
            patch("src.preprocessing.enhance.adaptive_binarize", side_effect=lambda *a, **kw: (call_order.append("binarize"), orig_binarize(*a, **kw))[1]),
        ):
            preprocess_for_ocr(data)

        assert call_order == ["resize", "deskew", "denoise", "enhance", "binarize"]
