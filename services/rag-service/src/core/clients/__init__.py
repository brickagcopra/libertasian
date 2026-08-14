"""HTTP clients for the internal services the RAG pipeline depends on."""

from .embedding_client import close_embedding_client, embed_query

__all__ = [
    "close_embedding_client",
    "embed_query",
]
