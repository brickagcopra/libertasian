"""LIBERTASIAN Worker Service — Configuration via Pydantic BaseSettings."""

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Worker service configuration. Loaded from environment variables."""

    # Redis
    redis_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/1"

    # Database (sync, for Celery tasks)
    database_url: str = "postgresql://libertasian:libertasian@localhost:5432/libertasian"

    # Read-replica DSN for read-heavy backfills. Falls back to ``database_url``
    # when unset so dev / single-node deployments still work; in production
    # this should point at the read-only Postgres replica described in
    # CLAUDE.md (Python services use the read-only pool for SELECTs).
    database_read_replica_url: str | None = None

    # OCR service
    ocr_service_url: str = "http://localhost:8002"

    # RAG service
    rag_service_url: str = "http://localhost:8000"
    rag_request_timeout: int = 180

    # S3 / MinIO
    s3_endpoint: str = "http://localhost:9000"
    s3_access_key: str = ""
    s3_secret_key: str = ""
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

    # Daily incremental crawl (PR2). Default off so the code ships disabled
    # and we turn it on deliberately after observing one manual run.
    crawl_daily_enabled: bool = False

    # Fetch window — gates both backfill ticks and daily crawls so we
    # never hit upstream sources during their business hours. Default
    # 13:00–18:00 America/New_York = 01:00–07:00 Asia/Manila (PH off-peak,
    # when LawPhil is least likely to throttle us).
    backfill_fetch_window_tz: str = "America/New_York"
    backfill_fetch_window_hour_start: int = Field(default=13, ge=0, le=23)
    backfill_fetch_window_hour_end: int = Field(default=18, ge=0, le=23)

    @model_validator(mode="after")
    def _validate_fetch_window(self) -> "Settings":
        if self.backfill_fetch_window_hour_start >= self.backfill_fetch_window_hour_end:
            raise ValueError(
                "backfill_fetch_window_hour_start must be strictly less than "
                "backfill_fetch_window_hour_end "
                f"(got start={self.backfill_fetch_window_hour_start}, "
                f"end={self.backfill_fetch_window_hour_end})"
            )
        # ZoneInfo will raise if the tz string is invalid; do it here so a
        # bad config fails at startup, not on the first tick.
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(self.backfill_fetch_window_tz)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(
                f"backfill_fetch_window_tz invalid: {self.backfill_fetch_window_tz!r}"
            ) from exc
        return self

    # Embedding service
    embedding_service_url: str = "http://localhost:8001"
    embedding_request_timeout: int = 120
    embedding_batch_size: int = 64

    # Derivative generation
    derivative_poll_batch_size: int = 10

    # Subject-classifier per-document attempt cap. Defense-in-depth against the
    # re-billing loop: once a doc has failed classification this many times it
    # is skipped by the unclassified sweep (fail-open — a Redis outage falls
    # back to dispatching, never blocks classification).
    classify_max_attempts: int = 5

    # NestJS API (for internal service-to-service calls)
    nestjs_api_url: str = "http://localhost:3001/api/v1"
    internal_api_key: str = ""

    # OpenSearch index-trigger retry. The trigger runs AFTER the publish has
    # been committed to PostgreSQL, so a dropped call leaves a live document
    # unsearchable — during the #322 backfill 5,220 of 11,561 triggers came
    # back 429 from the gateway throttler and were discarded with no retry.
    # The route no longer throttles the worker; these bounds are the belt to
    # that braces, and cover 5xx and transport errors as well.
    opensearch_index_max_attempts: int = Field(default=4, ge=1, le=10)
    opensearch_index_retry_base_delay: float = Field(default=0.5, ge=0.0, le=60.0)

    model_config = {"env_prefix": "WORKER_", "env_file": ".env", "extra": "ignore"}


settings = Settings()
