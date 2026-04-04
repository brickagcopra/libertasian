"""HTTP endpoint tests for all OCR service routers (Phase 2 — Coverage Gaps).

Tests cover request validation, error handling, and response shape for
every FastAPI endpoint. Service logic is mocked to isolate HTTP behavior.
"""

from __future__ import annotations

import io
from unittest.mock import MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app


@pytest.fixture()
async def client():
    """Async HTTP client for testing FastAPI endpoints."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


def make_jpeg_bytes() -> bytes:
    """Minimal valid JPEG file bytes (SOI + APP0 + EOI)."""
    return bytes([
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
        0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
        0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9,
    ])


def make_pdf_bytes() -> bytes:
    """Minimal valid PDF file bytes."""
    return (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n"
        b"0000000058 00000 n \n0000000115 00000 n \n"
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF"
    )


# ---- Health Check ----


class TestHealthEndpoint:
    @pytest.mark.asyncio
    async def test_health_check_returns_ok(self, client: AsyncClient):
        resp = await client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["service"] == "ocr-service"
        assert "version" in data


# ---- /quality/score ----


class TestQualityRouter:
    @pytest.mark.asyncio
    @patch("src.quality.router.score_image_quality")
    async def test_score_returns_quality_metrics(
        self, mock_score: MagicMock, client: AsyncClient
    ):
        mock_score.return_value = MagicMock(
            overall_score=0.75,
            metrics=MagicMock(
                blur_score=0.8,
                resolution_score=0.7,
                contrast_score=0.85,
                brightness_score=0.65,
                model_dump=lambda: {
                    "blur_score": 0.8,
                    "resolution_score": 0.7,
                    "contrast_score": 0.85,
                    "brightness_score": 0.65,
                },
            ),
            is_acceptable=True,
            needs_warning=False,
            recommendation="Image quality is acceptable for OCR.",
            model_dump=lambda: {
                "overall_score": 0.75,
                "metrics": {
                    "blur_score": 0.8,
                    "resolution_score": 0.7,
                    "contrast_score": 0.85,
                    "brightness_score": 0.65,
                },
                "is_acceptable": True,
                "needs_warning": False,
                "recommendation": "Image quality is acceptable for OCR.",
            },
        )

        resp = await client.post(
            "/quality/score",
            files={"file": ("test.jpg", make_jpeg_bytes(), "image/jpeg")},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "overall_score" in data
        assert "metrics" in data
        assert "is_acceptable" in data
        assert "needs_warning" in data
        assert "recommendation" in data
        mock_score.assert_called_once()

    @pytest.mark.asyncio
    async def test_score_rejects_missing_file(self, client: AsyncClient):
        resp = await client.post("/quality/score")
        assert resp.status_code == 422


# ---- /ocr/extract ----


class TestOcrRouter:
    @pytest.mark.asyncio
    @patch("src.ocr.router.extract_text")
    async def test_extract_returns_ocr_response(
        self, mock_extract: MagicMock, client: AsyncClient
    ):
        mock_extract.return_value = MagicMock(
            text="REPUBLIC OF THE PHILIPPINES\nSUPREME COURT\n...",
            confidence=0.92,
            word_count=150,
            language_detected="eng",
            model_dump=lambda: {
                "text": "REPUBLIC OF THE PHILIPPINES\nSUPREME COURT\n...",
                "confidence": 0.92,
                "word_count": 150,
                "language_detected": "eng",
            },
        )

        resp = await client.post(
            "/ocr/extract",
            files={"file": ("scan.jpg", make_jpeg_bytes(), "image/jpeg")},
            data={"language": "eng"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "text" in data
        assert "confidence" in data
        assert "word_count" in data
        assert "language_detected" in data
        mock_extract.assert_called_once()

    @pytest.mark.asyncio
    @patch("src.ocr.router.extract_text")
    async def test_extract_with_bilingual_language(
        self, mock_extract: MagicMock, client: AsyncClient
    ):
        mock_extract.return_value = MagicMock(
            text="Ang kasunduan...",
            confidence=0.78,
            word_count=50,
            language_detected="fil",
            model_dump=lambda: {
                "text": "Ang kasunduan...",
                "confidence": 0.78,
                "word_count": 50,
                "language_detected": "fil",
            },
        )

        resp = await client.post(
            "/ocr/extract",
            files={"file": ("scan.jpg", make_jpeg_bytes(), "image/jpeg")},
            data={"language": "eng+fil"},
        )
        assert resp.status_code == 200
        # Verify the language parameter was passed through
        call_args = mock_extract.call_args
        assert call_args[0][1] == "eng+fil"

    @pytest.mark.asyncio
    async def test_extract_rejects_missing_file(self, client: AsyncClient):
        resp = await client.post("/ocr/extract", data={"language": "eng"})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    @patch("src.ocr.router.extract_text")
    async def test_extract_defaults_to_english(
        self, mock_extract: MagicMock, client: AsyncClient
    ):
        mock_extract.return_value = MagicMock(
            text="Text",
            confidence=0.9,
            word_count=1,
            language_detected="eng",
            model_dump=lambda: {
                "text": "Text",
                "confidence": 0.9,
                "word_count": 1,
                "language_detected": "eng",
            },
        )

        resp = await client.post(
            "/ocr/extract",
            files={"file": ("scan.jpg", make_jpeg_bytes(), "image/jpeg")},
        )
        assert resp.status_code == 200
        call_args = mock_extract.call_args
        assert call_args[0][1] == "eng"


# ---- /classify ----


class TestClassifyRouter:
    @pytest.mark.asyncio
    @patch("src.classify.router.classify_document")
    async def test_classify_returns_result(
        self, mock_classify: MagicMock, client: AsyncClient
    ):
        mock_classify.return_value = MagicMock(
            document_type="case",
            confidence=0.95,
            model_dump=lambda: {"document_type": "case", "confidence": 0.95},
        )

        resp = await client.post(
            "/classify",
            json={"text": "REPUBLIC OF THE PHILIPPINES SUPREME COURT G.R. No. 123456"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["document_type"] == "case"
        assert data["confidence"] >= 0.0
        mock_classify.assert_called_once()

    @pytest.mark.asyncio
    async def test_classify_rejects_missing_text(self, client: AsyncClient):
        resp = await client.post("/classify", json={})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    @patch("src.classify.router.classify_document")
    async def test_classify_handles_unknown_type(
        self, mock_classify: MagicMock, client: AsyncClient
    ):
        mock_classify.return_value = MagicMock(
            document_type="unknown",
            confidence=0.0,
            model_dump=lambda: {"document_type": "unknown", "confidence": 0.0},
        )

        resp = await client.post(
            "/classify",
            json={"text": "Some random non-legal text with no patterns."},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["document_type"] == "unknown"


# ---- /citations/extract ----


class TestCitationsRouter:
    @pytest.mark.asyncio
    @patch("src.citations.router.extract_citations")
    async def test_extract_citations_returns_results(
        self, mock_extract: MagicMock, client: AsyncClient
    ):
        mock_extract.return_value = MagicMock(
            citations=["G.R. No. 123456", "R.A. No. 7610"],
            normalized_citations=["G.R. No. 123456", "Republic Act No. 7610"],
            model_dump=lambda: {
                "citations": ["G.R. No. 123456", "R.A. No. 7610"],
                "normalized_citations": ["G.R. No. 123456", "Republic Act No. 7610"],
            },
        )

        resp = await client.post(
            "/citations/extract",
            json={"text": "as held in G.R. No. 123456, citing R.A. No. 7610"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["citations"]) == 2
        assert len(data["normalized_citations"]) == 2
        mock_extract.assert_called_once()

    @pytest.mark.asyncio
    async def test_extract_citations_rejects_missing_text(self, client: AsyncClient):
        resp = await client.post("/citations/extract", json={})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    @patch("src.citations.router.extract_citations")
    async def test_extract_citations_handles_no_citations(
        self, mock_extract: MagicMock, client: AsyncClient
    ):
        mock_extract.return_value = MagicMock(
            citations=[],
            normalized_citations=[],
            model_dump=lambda: {"citations": [], "normalized_citations": []},
        )

        resp = await client.post(
            "/citations/extract",
            json={"text": "Just a normal sentence with no legal citations at all."},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["citations"] == []
        assert data["normalized_citations"] == []


# ---- /pdf/extract ----


class TestPdfRouter:
    @pytest.mark.asyncio
    @patch("src.pdf.router.extract_pdf_text")
    async def test_extract_pdf_returns_results(
        self, mock_extract: MagicMock, client: AsyncClient
    ):
        mock_extract.return_value = MagicMock(
            pages=[
                MagicMock(
                    page_number=1,
                    text="Page 1 content",
                    word_count=3,
                    is_ocr=False,
                    model_dump=lambda: {
                        "page_number": 1,
                        "text": "Page 1 content",
                        "word_count": 3,
                        "is_ocr": False,
                    },
                )
            ],
            total_text="Page 1 content",
            total_word_count=3,
            total_pages=1,
            confidence=0.99,
            language_detected="eng",
            has_text_layer=True,
            model_dump=lambda: {
                "pages": [
                    {
                        "page_number": 1,
                        "text": "Page 1 content",
                        "word_count": 3,
                        "is_ocr": False,
                    }
                ],
                "total_text": "Page 1 content",
                "total_word_count": 3,
                "total_pages": 1,
                "confidence": 0.99,
                "language_detected": "eng",
                "has_text_layer": True,
            },
        )

        resp = await client.post(
            "/pdf/extract",
            files={"file": ("document.pdf", make_pdf_bytes(), "application/pdf")},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "pages" in data
        assert "total_text" in data
        assert "total_word_count" in data
        assert "total_pages" in data
        assert "confidence" in data
        assert "has_text_layer" in data
        mock_extract.assert_called_once()

    @pytest.mark.asyncio
    async def test_extract_pdf_rejects_non_pdf(self, client: AsyncClient):
        """PDF endpoint validates magic bytes — non-PDF should return 400."""
        resp = await client.post(
            "/pdf/extract",
            files={"file": ("fake.pdf", b"This is not a PDF", "application/pdf")},
        )
        assert resp.status_code == 400
        assert "magic bytes" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_extract_pdf_rejects_empty_file(self, client: AsyncClient):
        resp = await client.post(
            "/pdf/extract",
            files={"file": ("empty.pdf", b"", "application/pdf")},
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_extract_pdf_rejects_missing_file(self, client: AsyncClient):
        resp = await client.post("/pdf/extract")
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_extract_pdf_rejects_exe_disguised_as_pdf(self, client: AsyncClient):
        """EXE magic bytes should be rejected by PDF endpoint."""
        exe_bytes = bytes([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])
        resp = await client.post(
            "/pdf/extract",
            files={"file": ("malicious.pdf", exe_bytes, "application/pdf")},
        )
        assert resp.status_code == 400
