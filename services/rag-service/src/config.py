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
    #
    # The count floor was written for corpus-wide search, where three passages
    # meant three independent documents corroborating each other. Scoped to a
    # single document it measures document LENGTH instead: the keyword index
    # holds sections+1 chunks per document, so a short document can never clear
    # it no matter how well it answers the question. Measured on prod
    # 2026-08-12: 505 documents (2.9%) hold only 2 chunks and hard-abstain on
    # every question; a further 4,974 (29%) hold exactly 3 and abstain unless
    # all three match. Hence a separate, lower floor for the scoped case.
    abstention_min_passages: int = 3
    abstention_min_passages_scoped: int = 1

    # LIVE as of the reranker deployment (search-epic C4). This gate was inert
    # for as long as no reranker existed — with rerank_score None,
    # check_abstention fell back to a raw RRF score, which encodes rank position
    # (~0.0164 at top-1) rather than relevance. It now compares real
    # cross-encoder probabilities, so the old 0.01 had to be re-derived rather
    # than carried over.
    #
    # MEASURED, not guessed. BAAI/bge-reranker-base scored 12 answerable legal
    # queries and 2 deliberately unanswerable ones against candidate sets built
    # from the documents prod retrieval actually returns (including the BM25
    # stopword distractors that motivated this epic). Sigmoid applied to the raw
    # logit, so scores are 0-1:
    #
    #   answerable   top-1: 0.0044 .. 0.9993   (median 0.83, correct doc top-1 in 12/12)
    #   unanswerable top-1: 3.74e-05           (both — the model's saturated "no")
    #
    # The two populations are separated by ~117x, but the boundary sits far
    # below the intuitive midpoint: a "relevant" passage frequently scores under
    # 0.5, and the lowest genuinely-answerable query scored 0.0044. The old 0.01
    # would therefore have ABSTAINED on a query the corpus can answer. 0.0004 is
    # the geometric midpoint of the measured gap — ~11x above the model's floor
    # and ~11x below the lowest answerable top-1, i.e. maximum ratio margin on
    # both sides.
    #
    # What this gate does and does not do: it rejects queries with NOTHING
    # relevant retrieved. It is not a quality bar — answerable top-1 scores span
    # 200x, so no single threshold separates "well answered" from "barely
    # answered". The citation-grounding abstention (#381) remains the effective
    # quality gate. Re-derive this from prod scores once real traffic has run
    # through the reranker.
    abstention_score_threshold: float = 0.0004

    # Embedding service — the kNN retrieval leg's input.
    #
    # Empty string still means "unconfigured": `embed_query` returns None,
    # `hybrid_retrieve` runs BM25-only and records `knn:not_configured`. That
    # degraded path is kept working on purpose, because it is what local dev and
    # any environment without the service will use.
    #
    # ``env_prefix`` is ``RAG_``, so the variable is **RAG_EMBEDDING_SERVICE_URL**
    # — the unprefixed EMBEDDING_SERVICE_URL is read by nothing here. Prod sets
    # it in docker-compose.prod.yml; rag-service and embedding-service both sit
    # on the `ai` network, so `http://embedding-service:8001` resolves.
    embedding_service_url: str = ""
    embedding_request_timeout: int = 5

    # Must equal the `dimension` on the knn_vector field of
    # `legal_documents_vector` (apps/api/src/modules/search/index-mappings.ts,
    # DEFAULT_EMBEDDING_DIM). BAAI/bge-small-en-v1.5 emits 384 and prod is
    # confirmed at 384. A vector of any other length is rejected by OpenSearch
    # as an opaque HTTP 400, so `embed_query` checks the length before the query
    # is ever built. Change this only in lockstep with EMBEDDING_DIM and a
    # reindex.
    embedding_dim: int = 384

    # Internal API key for service-to-service authentication
    internal_api_key: str = ""

    model_config = {"env_prefix": "RAG_", "env_file": ".env", "extra": "ignore"}


settings = Settings()
