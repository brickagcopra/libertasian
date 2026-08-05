"""LIBERTASIAN RAG Service — Configuration via Pydantic BaseSettings."""

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """RAG service configuration. All values loaded from environment variables."""

    app_name: str = "LIBERTASIAN RAG Service"
    app_version: str = "0.1.0"

    # PostgreSQL connection URL
    database_url: str = "postgresql://libertasian:libertasian@localhost:5432/libertasian"

    # OpenAI API (primary — used when openai_api_key is set)
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_request_timeout: int = 120

    # vLLM fallback (used when openai_api_key is empty)
    vllm_base_url: str = "http://localhost:8000/v1"
    vllm_model: str = "default"
    vllm_request_timeout: int = 120

    # OpenSearch
    #
    # Prod terminates TLS on the OpenSearch container itself with a self-signed
    # cert (https://opensearch:9200) and requires basic auth. BOTH are needed:
    # measured on prod 2026-08-05, verify=False alone returns 401 Unauthorized,
    # and verify=False + basic auth returns 200 with 10k+ hits. Neither was
    # configured here, so every request raised SSL: CERTIFICATE_VERIFY_FAILED
    # and the client swallowed it as "no results" — all Python-side retrieval
    # silently returned zero passages.
    #
    # The credentials are read from the UNPREFIXED ``OPENSEARCH_USERNAME`` /
    # ``OPENSEARCH_PASSWORD`` as well as the prefixed pair, because those are
    # what the rag-service container already has in its environment (from
    # ``env_file: .env``, the same values the cluster is initialised with).
    # Declaring the fields alone would NOT have fixed this: ``env_prefix`` is
    # ``RAG_``, so a bare ``opensearch_username`` reads only
    # ``RAG_OPENSEARCH_USERNAME``, which nothing sets — the service would have
    # kept sending unauthenticated requests and traded the TLS error for a 401.
    # The prefixed name is listed FIRST so an explicit per-service override
    # still wins. This keeps the fix code-only: no .env edit, no compose edit.
    #
    # verify_ssl defaults to False because the internal cert is self-signed and
    # the hop never leaves the container network. Set RAG_OPENSEARCH_VERIFY_SSL=true
    # (or point it at a CA bundle path via httpx) once a real cert is in place.
    opensearch_url: str = "http://localhost:9200"
    opensearch_username: str = Field(
        default="",
        validation_alias=AliasChoices("RAG_OPENSEARCH_USERNAME", "OPENSEARCH_USERNAME"),
    )
    opensearch_password: str = Field(
        default="",
        validation_alias=AliasChoices("RAG_OPENSEARCH_PASSWORD", "OPENSEARCH_PASSWORD"),
    )
    opensearch_verify_ssl: bool = False

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Doctrine extraction thresholds
    doctrine_confidence_threshold: float = 0.7
    doctrine_max_tokens: int = 4096

    # Citation resolution thresholds
    citation_match_threshold: float = 0.8

    # Memo generation
    memo_max_tokens: int = 8192

    # Digest generation
    digest_max_tokens: int = 8192

    # Case comparison
    comparison_max_tokens: int = 8192

    # Pleading generation
    pleading_max_tokens: int = 8192

    # Timeline generation
    timeline_max_tokens: int = 8192

    # Hearing prep
    hearing_prep_max_tokens: int = 8192

    # Contradiction detection
    contradiction_max_tokens: int = 8192

    # Research workspace queries
    research_query_max_tokens: int = 4096

    # Flashcard generation
    flashcard_generation_max_tokens: int = 4096

    # --- Core RAG pipeline settings ---

    # Answer generation
    answer_max_tokens: int = 4096
    answer_context_tokens: int = 4096

    # Reranker (empty string = disabled, uses RRF fallback)
    reranker_url: str = ""
    reranker_timeout: int = 10

    # Abstention thresholds
    abstention_min_passages: int = 3
    abstention_score_threshold: float = 0.01

    # Embedding service (empty string = kNN disabled, BM25 only)
    embedding_service_url: str = ""

    # Internal API key for service-to-service authentication
    internal_api_key: str = ""

    model_config = {"env_prefix": "RAG_", "env_file": ".env", "extra": "ignore"}


settings = Settings()
