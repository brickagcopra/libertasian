"""Pre-generation eligibility check — skips documents that can't produce good derivatives."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class EligibilityResult:
    eligible: bool
    skip_reason: str | None = None


def check_eligibility(
    confidence_score: float | None,
    total_plain_text_length: int,
) -> EligibilityResult:
    """Check if a document is eligible for derivative generation.

    Rules (from section 4.1):
    - Skip if confidenceScore < 0.5
    - Skip if total plain_text across sections < 500 characters
    """
    if confidence_score is not None and confidence_score < 0.5:
        return EligibilityResult(
            eligible=False,
            skip_reason=f"Document confidence score {confidence_score:.2f} below 0.5 threshold",
        )
    if total_plain_text_length < 500:
        return EligibilityResult(
            eligible=False,
            skip_reason=f"Total plain text length {total_plain_text_length} below 500 character minimum",
        )
    return EligibilityResult(eligible=True)
