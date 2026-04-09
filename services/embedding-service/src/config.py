"""LIBERTASIAN Embedding Service — Configuration via Pydantic BaseSettings."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Embedding service configuration. All values loaded from environment variables."""

    app_name: str = "LIBERTASIAN Embedding Service"
    app_version: str = "0.1.0"

    # Model configuration
    model_name: str = "BAAI/bge-small-en-v1.5"
    embedding_dim: int = 384
    max_batch_size: int = 64
    device: str = "cpu"

    # Operational limits
    max_input_length: int = 8192

    # Internal API key for service-to-service authentication
    internal_api_key: str = ""

    model_config = {"env_prefix": "EMBEDDING_", "env_file": ".env", "extra": "ignore"}


settings = Settings()
