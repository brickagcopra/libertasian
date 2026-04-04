"""Tests for quality/scorer.py — image quality scoring for OCR pipeline.

Uses synthetic numpy arrays and PIL images to test scoring functions
without needing real document images or OpenCV GUI.
"""

from __future__ import annotations

from io import BytesIO
from unittest.mock import patch

import numpy as np
import pytest
from PIL import Image

from src.quality.scorer import (
    _compute_blur_score,
    _compute_brightness_score,
    _compute_contrast_score,
    _compute_resolution_score,
    _load_image_as_cv2,
    score_image_quality,
)
from src.schemas import QualityScoreResponse


# ---------------------------------------------------------------------------
# Helpers — synthetic image generation
# ---------------------------------------------------------------------------


def _make_image_bytes(
    width: int = 800,
    height: int = 600,
    color: tuple[int, int, int] = (200, 200, 200),
    noise: bool = False,
    fmt: str = "JPEG",
) -> bytes:
    """Create a synthetic image as bytes for testing."""
    if noise:
        arr = np.random.randint(0, 256, (height, width, 3), dtype=np.uint8)
        img = Image.fromarray(arr, "RGB")
    else:
        img = Image.new("RGB", (width, height), color)
    buf = BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


def _make_gray_array(
    height: int = 100,
    width: int = 100,
    value: int = 128,
) -> np.ndarray:
    """Create a uniform grayscale numpy array."""
    return np.full((height, width), value, dtype=np.uint8)


def _make_high_contrast_gray(height: int = 100, width: int = 100) -> np.ndarray:
    """Create a grayscale image with high contrast (text-like: dark on light)."""
    arr = np.full((height, width), 220, dtype=np.uint8)
    # Add some dark regions (simulating text)
    arr[20:80, 20:80] = 30
    return arr


def _make_noisy_gray(height: int = 100, width: int = 100) -> np.ndarray:
    """Create a noisy grayscale image (high-frequency content = sharp)."""
    return np.random.randint(0, 256, (height, width), dtype=np.uint8)


# ---------------------------------------------------------------------------
# _load_image_as_cv2
# ---------------------------------------------------------------------------


class TestLoadImageAsCv2:
    def test_loads_rgb_jpeg(self) -> None:
        img_bytes = _make_image_bytes(100, 100)
        result = _load_image_as_cv2(img_bytes)

        assert isinstance(result, np.ndarray)
        assert result.shape == (100, 100, 3)
        assert result.dtype == np.uint8

    def test_loads_rgba_png_converts_to_rgb(self) -> None:
        img = Image.new("RGBA", (50, 50), (255, 0, 0, 128))
        buf = BytesIO()
        img.save(buf, format="PNG")

        result = _load_image_as_cv2(buf.getvalue())

        assert result.shape == (50, 50, 3)  # Should be RGB, not RGBA

    def test_preserves_pixel_values(self) -> None:
        img_bytes = _make_image_bytes(10, 10, color=(100, 150, 200))
        result = _load_image_as_cv2(img_bytes)

        # JPEG compression may alter values slightly, so use tolerance
        assert abs(int(result[5, 5, 0]) - 100) < 10
        assert abs(int(result[5, 5, 1]) - 150) < 10
        assert abs(int(result[5, 5, 2]) - 200) < 10


# ---------------------------------------------------------------------------
# _compute_blur_score
# ---------------------------------------------------------------------------


class TestComputeBlurScore:
    def test_uniform_image_is_blurry(self) -> None:
        """A perfectly uniform image has zero Laplacian variance → very blurry."""
        gray = _make_gray_array(100, 100, value=128)
        score = _compute_blur_score(gray)

        assert score == 0.0

    def test_noisy_image_is_sharp(self) -> None:
        """A noisy image has high Laplacian variance → sharp."""
        gray = _make_noisy_gray(200, 200)
        score = _compute_blur_score(gray)

        assert score > 0.8

    def test_score_range_0_to_1(self) -> None:
        gray = _make_noisy_gray(100, 100)
        score = _compute_blur_score(gray)

        assert 0.0 <= score <= 1.0

    def test_moderate_sharpness(self) -> None:
        """An image with some edges should have moderate sharpness."""
        gray = _make_high_contrast_gray(100, 100)
        score = _compute_blur_score(gray)

        # Has edges (dark/light transition) but not pure noise
        assert 0.1 <= score <= 0.95


# ---------------------------------------------------------------------------
# _compute_resolution_score
# ---------------------------------------------------------------------------


class TestComputeResolutionScore:
    def test_high_resolution(self) -> None:
        assert _compute_resolution_score(2000, 1500) == 1.0
        assert _compute_resolution_score(3000, 2000) == 1.0

    def test_exact_threshold(self) -> None:
        assert _compute_resolution_score(1500, 1000) == 1.0

    def test_very_low_resolution(self) -> None:
        assert _compute_resolution_score(300, 200) == 0.0
        assert _compute_resolution_score(100, 100) == 0.0

    def test_linear_interpolation(self) -> None:
        # 900px longest side: (900 - 300) / 1200 = 0.5
        assert _compute_resolution_score(900, 600) == 0.5

    def test_just_above_minimum(self) -> None:
        # 301px: (301 - 300) / 1200 ≈ 0.00083
        score = _compute_resolution_score(301, 200)
        assert score > 0.0
        assert score < 0.01

    def test_width_is_longer_side(self) -> None:
        """When width > height, width should be used as longer side."""
        score = _compute_resolution_score(600, 1500)
        assert score == 1.0

    def test_square_image(self) -> None:
        score = _compute_resolution_score(900, 900)
        assert score == 0.5


# ---------------------------------------------------------------------------
# _compute_contrast_score
# ---------------------------------------------------------------------------


class TestComputeContrastScore:
    def test_high_contrast(self) -> None:
        gray = _make_high_contrast_gray(100, 100)
        score = _compute_contrast_score(gray)

        assert score > 0.8

    def test_uniform_image_low_contrast(self) -> None:
        gray = _make_gray_array(100, 100, value=128)
        score = _compute_contrast_score(gray)

        assert score == 0.0

    def test_score_range(self) -> None:
        gray = _make_noisy_gray(100, 100)
        score = _compute_contrast_score(gray)

        assert 0.0 <= score <= 1.0

    def test_high_std_dev_full_score(self) -> None:
        """Image with std dev >= 60 should get 1.0."""
        # Create an image with values spread across 0-255
        gray = np.tile(
            np.arange(0, 256, dtype=np.uint8).reshape(1, 256),
            (100, 1),
        )[:, :200]
        score = _compute_contrast_score(gray)

        assert score >= 0.95

    def test_very_low_std_dev(self) -> None:
        """Image with std dev <= 10 should get 0.0."""
        gray = np.full((100, 100), 128, dtype=np.uint8)
        # Add very small variation
        gray[0:2, 0:2] = 130
        score = _compute_contrast_score(gray)

        assert score < 0.1


# ---------------------------------------------------------------------------
# _compute_brightness_score
# ---------------------------------------------------------------------------


class TestComputeBrightnessScore:
    def test_ideal_brightness(self) -> None:
        """Mean brightness 130-210 should score 1.0."""
        gray = _make_gray_array(100, 100, value=170)
        assert _compute_brightness_score(gray) == 1.0

    def test_lower_ideal_boundary(self) -> None:
        gray = _make_gray_array(100, 100, value=130)
        assert _compute_brightness_score(gray) == 1.0

    def test_upper_ideal_boundary(self) -> None:
        gray = _make_gray_array(100, 100, value=210)
        assert _compute_brightness_score(gray) == 1.0

    def test_very_dark(self) -> None:
        gray = _make_gray_array(100, 100, value=40)
        assert _compute_brightness_score(gray) == 0.0

    def test_very_bright(self) -> None:
        gray = _make_gray_array(100, 100, value=250)
        assert _compute_brightness_score(gray) == 0.0

    def test_moderately_dark(self) -> None:
        """Mean brightness between 50 and 130 should score linearly."""
        gray = _make_gray_array(100, 100, value=90)
        score = _compute_brightness_score(gray)
        # (90 - 50) / 80 = 0.5
        assert abs(score - 0.5) < 0.01

    def test_moderately_bright(self) -> None:
        """Mean brightness between 210 and 245 should score linearly."""
        gray = _make_gray_array(100, 100, value=227)
        score = _compute_brightness_score(gray)
        # (245 - 227.5) / 35 = 0.5 (approx)
        assert 0.3 <= score <= 0.7

    def test_edge_values(self) -> None:
        gray_50 = _make_gray_array(100, 100, value=50)
        assert _compute_brightness_score(gray_50) == 0.0

        gray_245 = _make_gray_array(100, 100, value=245)
        assert _compute_brightness_score(gray_245) == 0.0


# ---------------------------------------------------------------------------
# score_image_quality — integration
# ---------------------------------------------------------------------------


class TestScoreImageQuality:
    def test_returns_quality_response(self) -> None:
        img_bytes = _make_image_bytes(1600, 1200, color=(180, 180, 180), noise=True)
        result = score_image_quality(img_bytes)

        assert isinstance(result, QualityScoreResponse)
        assert 0.0 <= result.overall_score <= 1.0

    def test_metrics_populated(self) -> None:
        img_bytes = _make_image_bytes(1600, 1200, noise=True)
        result = score_image_quality(img_bytes)

        assert 0.0 <= result.metrics.blur_score <= 1.0
        assert 0.0 <= result.metrics.resolution_score <= 1.0
        assert 0.0 <= result.metrics.contrast_score <= 1.0
        assert 0.0 <= result.metrics.brightness_score <= 1.0

    def test_high_quality_image(self) -> None:
        """A high-res noisy image (simulating document) should score well."""
        # Create a document-like image: white bg with dark text areas
        arr = np.full((2000, 1500, 3), 200, dtype=np.uint8)
        # Add text-like dark patches
        for i in range(20):
            y = 50 + i * 90
            arr[y : y + 20, 100:1400] = 30
        # Add some noise for sharpness
        noise = np.random.randint(-10, 10, arr.shape, dtype=np.int16)
        arr = np.clip(arr.astype(np.int16) + noise, 0, 255).astype(np.uint8)

        img = Image.fromarray(arr, "RGB")
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=95)

        result = score_image_quality(buf.getvalue())
        assert result.overall_score > 0.4
        assert result.is_acceptable is True

    def test_very_low_quality_rejected(self) -> None:
        """A tiny, uniform, dark image should be rejected."""
        img_bytes = _make_image_bytes(100, 100, color=(30, 30, 30))

        with patch("src.quality.scorer.settings") as mock_settings:
            mock_settings.quality_reject_threshold = 0.2
            mock_settings.quality_warn_threshold = 0.4
            result = score_image_quality(img_bytes)

        assert result.overall_score < 0.2
        assert result.is_acceptable is False
        assert "too low" in result.recommendation.lower()

    def test_marginal_quality_warned(self) -> None:
        """An image with score between reject and warn thresholds gets warning."""
        # Medium-res, moderate contrast
        img_bytes = _make_image_bytes(800, 600, noise=True)

        with patch("src.quality.scorer.settings") as mock_settings:
            mock_settings.quality_reject_threshold = 0.2
            mock_settings.quality_warn_threshold = 0.9  # Set high to trigger warning
            result = score_image_quality(img_bytes)

        if result.overall_score >= 0.2 and result.overall_score < 0.9:
            assert result.needs_warning is True
            assert "marginal" in result.recommendation.lower()

    def test_acceptable_quality_no_warning(self) -> None:
        """An image above warn threshold should not have a warning."""
        img_bytes = _make_image_bytes(1600, 1200, noise=True)

        with patch("src.quality.scorer.settings") as mock_settings:
            mock_settings.quality_reject_threshold = 0.2
            mock_settings.quality_warn_threshold = 0.3
            result = score_image_quality(img_bytes)

        if result.overall_score >= 0.3:
            assert result.needs_warning is False
            assert "acceptable" in result.recommendation.lower()

    def test_weighting_blur_dominant(self) -> None:
        """Blur has 40% weight — verify it dominates the overall score."""
        # Uniform image: blur=0, but good resolution/contrast/brightness
        arr = np.full((2000, 1500, 3), 180, dtype=np.uint8)
        img = Image.fromarray(arr, "RGB")
        buf = BytesIO()
        img.save(buf, format="JPEG")

        result = score_image_quality(buf.getvalue())

        # blur=0 (40% weight), res=1.0 (25%), contrast=0 (25%), brightness~1.0 (10%)
        # Expected: ~0.25 + 0.10 = ~0.35
        assert result.metrics.blur_score < 0.05
        assert result.overall_score < 0.5

    def test_scores_are_rounded(self) -> None:
        img_bytes = _make_image_bytes(800, 600, noise=True)
        result = score_image_quality(img_bytes)

        # All scores should be rounded to 4 decimal places
        assert result.overall_score == round(result.overall_score, 4)
        assert result.metrics.blur_score == round(result.metrics.blur_score, 4)
        assert result.metrics.resolution_score == round(result.metrics.resolution_score, 4)
        assert result.metrics.contrast_score == round(result.metrics.contrast_score, 4)
        assert result.metrics.brightness_score == round(result.metrics.brightness_score, 4)

    def test_grayscale_input_handled(self) -> None:
        """A grayscale image (no color channels) should still work."""
        gray = np.random.randint(50, 200, (800, 600), dtype=np.uint8)
        img = Image.fromarray(gray, "L")
        buf = BytesIO()
        img.save(buf, format="JPEG")

        # The scorer converts RGB to gray; a grayscale input becomes
        # a 2D array after loading, which the scorer should handle
        result = score_image_quality(buf.getvalue())
        assert isinstance(result, QualityScoreResponse)
