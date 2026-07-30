"""LIBERTASIAN TTS Service — configuration via Pydantic BaseSettings."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """TTS service configuration. All values loaded from environment variables."""

    app_name: str = "LIBERTASIAN TTS Service"
    app_version: str = "0.1.0"

    # Kokoro model + default voice.
    tts_model_repo: str = "hexgrad/Kokoro-82M"
    tts_default_voice: str = "af_heart"

    # Concurrency. Kokoro-82M barely scales with threads, so throughput comes
    # from running SEVERAL NARROW workers rather than one wide one.
    #
    # MEASURED ON PROD (2026-07-29), superseding the Phase 0 spike's 3.59x @ 4
    # threads / 4.28x @ 12 — that figure was wrong by ~3.7x. Real warm
    # throughput at 4 threads is ~0.97x REALTIME: 1,793 chars produced 131.0 s
    # of audio in 135-142 s of wall clock, with CPU at 400-450% (i.e. threading
    # is configured correctly; the old constant was simply not measured).
    # Plan capacity against ~1x realtime per worker, not 3.6x.
    #
    # 2x4 = 8 threads by default, not 3x4 = 12: the prod box is 12 vCPU and
    # also serves the API. Tune upward only after measuring on the VPS.
    tts_workers: int = 2
    tts_threads_per_worker: int = 4

    # Torch device for the Kokoro pipeline.
    #
    # "auto" (the default, and prod's setting) passes NO device to KPipeline, so
    # kokoro keeps its own selection — byte-identical behaviour to before this
    # knob existed. The GPU image sets "cuda" EXPLICITLY: a silent fallback to
    # CPU on a rented GPU box would look like a working service while producing
    # ~1x realtime, which is the entire reason for renting the box.
    tts_device: str = "auto"

    # Bearer token required on /synthesize. Empty (the default, and prod's
    # setting) disables the check, because in prod this endpoint is reachable
    # only from the API over the internal Docker network. It MUST be set on any
    # deployment where the TTS host is remote.
    #
    # /health is deliberately NOT behind it — the container HEALTHCHECK curls it
    # with no credentials.
    tts_auth_token: str = ""

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()
