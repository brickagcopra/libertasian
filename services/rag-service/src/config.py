"""LIBERTASIAN RAG Service — Configuration via Pydantic BaseSettings."""

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
    opensearch_url: str = "http://localhost:9200"

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

    model_config = {"env_prefix": "RAG_", "env_file": ".env", "extra": "ignore"}


settings = Settings()
