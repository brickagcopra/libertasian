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


class SchemaIntegrityError(RuntimeError):
    """Raised when raw SQL references a table or column that does not exist.

    Mirrors the worker-service ``db_client.SchemaIntegrityError`` pattern
    introduced in PR #78. Indicates a code/schema drift bug — typically a
    PascalCase identifier left over from a pre-``@@map`` schema, or a
    phantom column referenced from a SELECT list that never existed in
    the Prisma model. Callers MUST NOT swallow this error: hiding it
    behind a generic ``except Exception`` is exactly how the original
    PascalCase regression silently degraded ingestion across 1421
    documents in April 2026.

    Intentionally NOT a subclass of ``RagPipelineError`` so that any
    pipeline-level catch-all (``except RagPipelineError``) still lets
    schema-integrity failures bubble up to the FastAPI error handler.
    """
