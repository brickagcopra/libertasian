"""LIBERTASIAN Worker Service — Configuration via Pydantic BaseSettings."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Worker service configuration. Loaded from environment variables."""

    # Redis
    redis_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/1"

    # Database (sync, for Celery tasks)
    database_url: str = "postgresql://libertasian:libertasian@localhost:5432/libertasian"

    # OCR service
    ocr_service_url: str = "http://localhost:8002"

    # RAG service
    rag_service_url: str = "http://localhost:8000"
    rag_request_timeout: int = 180

    # S3 / MinIO
    s3_endpoint: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket_uploads: str = "libertasian-uploads"
    s3_bucket_corpus: str = "libertasian-corpus"
    s3_region: str = "us-east-1"

    # Timeouts (seconds)
    ocr_request_timeout: int = 60
    quality_request_timeout: int = 30
    classify_request_timeout: int = 30
    citation_request_timeout: int = 30

    # Ingestion pipeline
    ingestion_fetch_timeout: int = 60
    ingestion_request_delay: float = 2.0
    ingestion_user_agent: str = "LIBERTASIAN-Ingestion/0.1"

    # Embedding service
    embedding_service_url: str = "http://localhost:8001"
    embedding_request_timeout: int = 120
    embedding_batch_size: int = 64

    # NestJS API (for internal service-to-service calls)
    nestjs_api_url: str = "http://localhost:3001/api/v1"
    internal_api_key: str = "dev-internal-api-key"

    model_config = {"env_prefix": "WORKER_", "env_file": ".env", "extra": "ignore"}


settings = Settings()
