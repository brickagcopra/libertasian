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
    """Raised when an LLM budget ceiling has been reached.

    Carries which budget stopped the call so the 503 body can name it.
    A caller that only knows "AI is unavailable" cannot tell an operator
    which limit to raise — that ambiguity is what turned an exhausted
    $50 global cap into four days of dead generation with no signal.

    Attributes:
        scope: Budget category that was exhausted (e.g. ``case_digest``),
            or ``None`` when the global ceiling was the one hit.
        period: ``"monthly"`` or ``"daily"``.
    """

    def __init__(
        self,
        message: str,
        *,
        scope: str | None = None,
        period: str = "monthly",
    ) -> None:
        super().__init__(message)
        self.scope = scope
        self.period = period


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
