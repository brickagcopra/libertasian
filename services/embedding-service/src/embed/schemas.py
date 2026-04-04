"""Embedding service Pydantic schemas — request/response models."""

from pydantic import BaseModel, ConfigDict, Field


class EmbedRequest(BaseModel):
    """Request body for single text embedding."""

    model_config = ConfigDict(strict=True)

    text: str = Field(min_length=1, max_length=32768)


class EmbedResponse(BaseModel):
    """Response body from single text embedding."""

    embedding: list[float]
    model_name: str
    dimension: int


class BatchEmbedRequest(BaseModel):
    """Request body for batch text embedding."""

    model_config = ConfigDict(strict=True)

    texts: list[str] = Field(min_length=1, max_length=256)


class BatchEmbedResponse(BaseModel):
    """Response body from batch text embedding."""

    embeddings: list[list[float]]
    model_name: str
    dimension: int
    count: int
