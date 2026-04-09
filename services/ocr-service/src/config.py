"""LIBERTASIAN OCR Service — Configuration via Pydantic BaseSettings."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """OCR service configuration. All values loaded from environment variables."""

    app_name: str = "LIBERTASIAN OCR Service"
    app_version: str = "0.1.0"
    debug: bool = False

    # Tesseract configuration
    tesseract_cmd: str = "tesseract"
    tesseract_lang: str = "eng"

    # Quality scoring thresholds (per CLAUDE.md SCAN_QUALITY constants)
    quality_reject_threshold: float = 0.2
    quality_warn_threshold: float = 0.4

    # Image preprocessing defaults
    max_image_width: int = 2048
    max_image_height: int = 2048
    jpeg_quality: int = 85

    # PDF extraction settings
    pdf_render_dpi: int = 200
    pdf_min_words_per_page: int = 10

    # Service URLs for inter-service communication
    worker_service_url: str = "http://localhost:8001"

    # Internal API key for service-to-service authentication
    internal_api_key: str = ""

    model_config = {"env_prefix": "OCR_", "env_file": ".env", "extra": "ignore"}


settings = Settings()
