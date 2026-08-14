"""LIBERTASIAN Reranker Service — Configuration via Pydantic BaseSettings."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Reranker service configuration. All values loaded from environment variables."""

    app_name: str = "LIBERTASIAN Reranker Service"
    app_version: str = "0.1.0"

    # Model configuration.
    #
    # BAAI/bge-reranker-base is the cross-encoder companion to
    # BAAI/bge-small-en-v1.5, which already produces the query and passage
    # embeddings in the kNN retrieval leg. Same family, same training data —
    # pairing them is the configuration the model card recommends.
    #
    # CPU by design: the GPU pod was released, and a base-sized cross-encoder
    # over the ~30 fused candidates a query produces is comfortably a CPU
    # workload.
    model_name: str = "BAAI/bge-reranker-base"
    device: str = "cpu"

    # Operational limits.
    #
    # `max_passages` guards the request, not the model: the caller sends the
    # fused candidate set (top_k * 2 = 60 at the widest today), and a
    # cross-encoder is O(n) forward passes, so an unbounded list is a trivial
    # way to pin the CPU. `max_passage_length` mirrors the 1000-char truncation
    # rag-service already applies client-side in `core/reranking.py`.
    max_passages: int = 128
    max_passage_length: int = 2000
    batch_size: int = 32

    # Internal API key for service-to-service authentication.
    #
    # Enforced by `shared/auth.verify_internal_key`, exactly as
    # embedding-service does. Empty means "dev mode, no auth" — the same
    # escape hatch, and the same trap: if this is set here but the CALLER does
    # not send the header, every request 403s and rag-service silently falls
    # back to RRF. `core/reranking.py` sends it; `test_rerank_contract.py`
    # asserts it does.
    internal_api_key: str = ""

    model_config = {"env_prefix": "RERANKER_", "env_file": ".env", "extra": "ignore"}


settings = Settings()
