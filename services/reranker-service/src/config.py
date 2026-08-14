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

    # --- CPU latency budget ---
    #
    # Measured on prod 2026-08-14: scoring 30 passages took 11.2-11.5s even
    # with 8 CPUs available, against rag-service's 10s `reranker_timeout`. Every
    # call timed out and fell back to RRF, so the service was functionally
    # correct and operationally useless. These three settings are the fix; none
    # of them touches the scoring math.

    # Torch defaults its intra-op pool to the HOST core count, which it reads
    # straight from /proc — it does not see the cgroup CPU quota. On a 12-core
    # host inside a `cpus: "2"` container that means 12 threads fighting over 2
    # cores' worth of quota: context-switch thrash, not parallelism. Pin it to
    # the quota the container actually has.
    torch_threads: int = 2

    # bge-reranker-base has a 512-token window and `CrossEncoder` uses the full
    # window unless told otherwise. Transformer attention is O(n^2) in sequence
    # length, so halving the window is roughly a 4x cut in attention cost.
    # rag-service truncates passages to 1000 characters before sending — call it
    # ~250 tokens of English legal prose — so 256 tokens covers essentially the
    # whole payload it actually sends. This is the single biggest win here.
    max_length: int = 256

    # Dynamic int8 quantization of the Linear layers — OFF by default, on
    # evidence rather than on principle.
    #
    # It was measured, not assumed. On the platform available for testing
    # (aarch64, torch 2.13) it does not work at all: `fbgemm` cannot even
    # construct the quantized module ("unknown architecure"), and `onednn` and
    # `qnnpack` construct one whose every forward pass then dies with
    # `KeyError: 'ne'`. torch 2.13 is itself deprecating this eager-mode API in
    # favour of torchao. And the latency targets are met WITHOUT it — 30
    # passages at p95 5.7s on 4 CPUs against a 10s caller timeout — so enabling
    # an unvalidated optimisation would be buying risk for a gain nobody has
    # observed.
    #
    # The code path is kept and hardened: `_quantize_dynamic` now tries each
    # supported backend, proves it with a real forward pass, and falls back to
    # fp32 if that fails. Turn it on once it has been measured on the target
    # platform — `/health` reports whether it ACTUALLY applied, not what was
    # asked for.
    quantize: bool = False

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
