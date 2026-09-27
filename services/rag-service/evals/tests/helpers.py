"""Builders shared by the evals tests."""

from __future__ import annotations

from evals.model import QuestionResult, SourceRecord, Status


def src(
    title: str = "Some Case",
    citation: str = "",
    document_type: str = "decision",
    rerank_score: float | None = 0.5,
) -> SourceRecord:
    return SourceRecord(
        title=title,
        citation=citation,
        gr_no=None,
        document_type=document_type,
        rerank_score=rerank_score,
    )


def qr(
    id: str = "q",  # noqa: A002 - mirrors the result field name
    *,
    subject: str = "Civil Law",
    must_abstain: bool = False,
    status: Status = "answered",
    expected: list[dict[str, str]] | None = None,
    sources: list[SourceRecord] | None = None,
    citations_total: int = 0,
    citations_valid: int = 0,
    latency_ms: float = 100.0,
) -> QuestionResult:
    return QuestionResult(
        id=id,
        subject=subject,
        must_abstain=must_abstain,
        expected_authorities=expected if expected is not None else [],
        status=status,
        sources=sources or [],
        citations_total=citations_total,
        citations_valid=citations_valid,
        latency_ms=latency_ms,
    )
