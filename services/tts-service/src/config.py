"""LIBERTASIAN TTS Service — configuration via Pydantic BaseSettings."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """TTS service configuration. All values loaded from environment variables."""

    app_name: str = "LIBERTASIAN TTS Service"
    app_version: str = "0.1.0"

    # Kokoro model + default voice.
    tts_model_repo: str = "hexgrad/Kokoro-82M"
    tts_default_voice: str = "af_heart"

    # Concurrency. Kokoro-82M barely scales with threads — the Phase 0 spike
    # measured only ~16% more RTF going from 4 to 12 threads (3.59x -> 4.28x on
    # an 8k-char decision) — so throughput comes from running SEVERAL NARROW
    # workers rather than one wide one.
    #
    # 2x4 = 8 threads by default, not 3x4 = 12: the prod box is 12 vCPU and
    # also serves the API. Tune upward only after measuring on the VPS.
    tts_workers: int = 2
    tts_threads_per_worker: int = 4

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()
