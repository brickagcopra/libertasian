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

    # A GUARD, not a measured optimisation — the distinction matters, because
    # the reasoning that motivated it does not survive contact with the data.
    #
    # The theory was that bge-reranker-base's 512-token window costs ~4x what a
    # 256-token one does, attention being O(n^2). The flaw: `max_length`
    # TRUNCATES, it does not pad. Sequences are padded to the longest item in
    # the batch, not to the window. rag-service already truncates passages to
    # 1000 characters (~250 tokens of English legal prose) before sending, so
    # real batches were never near 512 and this cap almost never binds.
    # Benchmarked at 30 passages, it changes p50 by nothing measurable; the
    # latency win in this service came from thread pinning and lifespan warm-up.
    #
    # Kept because it costs nothing and bounds the worst case: if a caller ever
    # sends an oversized passage, this is what stops one request from monopolising
    # the CPU budget.
    max_length: int = 256

    # How many rerank requests may hold the model at once.
    #
    # ONE, deliberately. `asyncio.to_thread` uses the default executor, which
    # sizes itself from `os.cpu_count()` — the HOST's core count, not the
    # container's quota — so N concurrent requests become N scoring threads,
    # each of which then asks torch for `torch_threads` threads of its own. That
    # is precisely the oversubscription this service was just fixed for, walked
    # back in through concurrency instead of configuration.
    #
    # Serialising is the right trade because torch already parallelises a single
    # batch across every core in the quota: a second concurrent request has no
    # idle CPU to use, it can only take cycles from the first. Queueing beats
    # thrashing because thrash makes BOTH requests miss the caller's 10s
    # timeout, whereas queueing at least lets the first one finish on time.
    #
    # Scale with replicas, not with this number.
    max_concurrent_requests: int = 1

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
