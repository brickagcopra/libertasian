"""Derivative artifact validators — per-type quality gates."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Protocol

logger = logging.getLogger(__name__)


class DerivativeVerdict(str, Enum):
    """Validator verdict for a derivative artifact."""

    PUBLISH = "publish"  # passes all checks -> write with review_status='approved'
    HUMAN_REVIEW = "human_review"  # soft failures -> write with review_status='needs_human_review'
    QUARANTINE = "quarantine"  # hard failures -> don't write, mark job failed


@dataclass(frozen=True)
class ValidatorCheck:
    """Result of a single validation check."""

    name: str
    passed: bool
    reason: str
    severity: str = "error"  # "error" (blocks publish) | "warning" (forces human_review) | "info"


@dataclass
class DerivativeValidationResult:
    """Aggregate result from all checks on one derivative."""

    verdict: DerivativeVerdict
    checks: list[ValidatorCheck] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)

    @property
    def errors(self) -> list[ValidatorCheck]:
        return [c for c in self.checks if not c.passed and c.severity == "error"]

    @property
    def warnings(self) -> list[ValidatorCheck]:
        return [c for c in self.checks if not c.passed and c.severity == "warning"]


@dataclass(frozen=True)
class LegalDocumentSnapshot:
    """Minimal document data passed to validators (no DB calls in validators)."""

    id: str
    title: str
    document_type: str
    citation_text: str | None
    court: str | None
    decision_date: str | None
    confidence_score: float | None


@dataclass(frozen=True)
class LegalDocumentSectionSnapshot:
    """Minimal section data passed to validators."""

    id: str
    section_type: str
    plain_text: str
    page_start: int | None
    page_end: int | None


class DerivativeValidator(Protocol):
    """Protocol for derivative-type-specific validators."""

    def validate(
        self,
        *,
        derivative_type: str,
        content: dict[str, Any],
        source_document: LegalDocumentSnapshot,
        source_sections: list[LegalDocumentSectionSnapshot],
    ) -> DerivativeValidationResult: ...


# --- Dispatch registry ---

_VALIDATOR_REGISTRY: dict[str, DerivativeValidator] = {}


def register_validator(derivative_type: str, validator: DerivativeValidator) -> None:
    _VALIDATOR_REGISTRY[derivative_type] = validator


def validate_derivative(
    derivative_type: str,
    content: dict[str, Any],
    source_document: LegalDocumentSnapshot,
    source_sections: list[LegalDocumentSectionSnapshot],
) -> DerivativeValidationResult:
    """Look up and run the validator for a derivative type."""
    validator = _VALIDATOR_REGISTRY.get(derivative_type)
    if validator is None:
        logger.warning(
            "No validator registered for type=%s, defaulting to human_review",
            derivative_type,
        )
        return DerivativeValidationResult(
            verdict=DerivativeVerdict.HUMAN_REVIEW,
            checks=[],
            reasons=[f"No validator registered for {derivative_type}"],
        )
    return validator.validate(
        derivative_type=derivative_type,
        content=content,
        source_document=source_document,
        source_sections=source_sections,
    )
