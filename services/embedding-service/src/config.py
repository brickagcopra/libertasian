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
    # torch intra-op threads. 0 leaves torch's default, which is one thread per
    # HOST core: torch does not read the cgroup quota, so in a `cpus: "2"`
    # container that is 12 threads contending for 2 cores and CFS throttles
    # them. Set it equal to the container's cpus limit (docker-compose.prod.yml
    # does), as the reranker already does.
    torch_threads: int = 0

    # Operational limits
    max_input_length: int = 8192

    # Internal API key for service-to-service authentication
    internal_api_key: str = ""

    model_config = {"env_prefix": "EMBEDDING_", "env_file": ".env", "extra": "ignore"}


settings = Settings()
