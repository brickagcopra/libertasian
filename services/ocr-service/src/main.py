"""LIBERTASIAN OCR Service — FastAPI application entry point."""

from fastapi import FastAPI
from prometheus_fastapi_instrumentator import Instrumentator

from .config import settings
from .quality.router import router as quality_router
from .ocr.router import router as ocr_router
from .classify.router import router as classify_router
from .citations.router import router as citations_router
from .pdf.router import router as pdf_router
from .schemas import HealthResponse

app = FastAPI(
    title=settings.app_name,
    description="OCR and image quality scoring for camera scan pipeline",
    version=settings.app_version,
)

app.include_router(quality_router)
app.include_router(ocr_router)
app.include_router(classify_router)
app.include_router(citations_router)
app.include_router(pdf_router)

Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Health check endpoint for load balancer and orchestration."""
    return HealthResponse(
        status="ok",
        service="ocr-service",
        version=settings.app_version,
    )
