"""Custom exceptions for the RAG pipeline."""


class RagPipelineError(Exception):
    """Base exception for all RAG pipeline errors."""


class RetrievalError(RagPipelineError):
    """Raised when document retrieval fails."""


class GenerationError(RagPipelineError):
    """Raised when LLM generation fails."""


class ValidationError(RagPipelineError):
    """Raised when output validation detects unsupported claims or missing citations."""


class AbstentionError(RagPipelineError):
    """Raised when the pipeline determines it cannot answer reliably."""


class BudgetExceededError(RagPipelineError):
    """Raised when the monthly LLM budget limit has been reached."""
