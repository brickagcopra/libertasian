"""FlashcardValidator — validates flashcard generation output.

Flashcards write to the existing Flashcard + FlashcardSet tables,
NOT DerivativeArtifact. This validator ensures card quality before
the Celery task writes via the NestJS internal endpoint.

Thresholds:
- front: 5–200 words
- back: 5–500 words
- at least 1 card (unless abstain)
- max 10 cards per batch
- each card should have at least 1 supportingSectionId
"""

from __future__ import annotations

from typing import Any

from . import (
    DerivativeValidationResult,
    DerivativeVerdict,
    LegalDocumentSectionSnapshot,
    LegalDocumentSnapshot,
    ValidatorCheck,
    register_validator,
)

MIN_FRONT_WORDS = 5
MAX_FRONT_WORDS = 200
MIN_BACK_WORDS = 5
MAX_BACK_WORDS = 500
MAX_CARDS_PER_BATCH = 10


class FlashcardValidator:
    """Validates flashcard generation output."""

    def validate(
        self,
        *,
        derivative_type: str,
        content: dict[str, Any],
        source_document: LegalDocumentSnapshot,
        source_sections: list[LegalDocumentSectionSnapshot],
    ) -> DerivativeValidationResult:
        checks: list[ValidatorCheck] = []
        cards = content.get("cards", [])

        # --- Abstain check ---
        if content.get("abstain"):
            reason = content.get("abstainReason", "unknown reason")
            checks.append(
                ValidatorCheck(
                    name="abstain_flag",
                    passed=False,
                    reason=f"LLM abstained: {reason}",
                    severity="error",
                )
            )
            return self._compute_verdict(checks)

        # --- At least 1 card ---
        if not cards:
            checks.append(
                ValidatorCheck(
                    name="card_count_min",
                    passed=False,
                    reason="No cards generated (expected at least 1)",
                    severity="error",
                )
            )
            return self._compute_verdict(checks)

        checks.append(
            ValidatorCheck(
                name="card_count_min",
                passed=True,
                reason=f"{len(cards)} card(s) generated",
                severity="info",
            )
        )

        # --- Fanout cap ---
        if len(cards) > MAX_CARDS_PER_BATCH:
            checks.append(
                ValidatorCheck(
                    name="fanout_cap",
                    passed=False,
                    reason=f"{len(cards)} cards exceeds max {MAX_CARDS_PER_BATCH}",
                    severity="warning",
                )
            )
        else:
            checks.append(
                ValidatorCheck(
                    name="fanout_cap",
                    passed=True,
                    reason=f"{len(cards)} cards within limit",
                    severity="info",
                )
            )

        # --- Per-card checks ---
        valid_section_ids = {s.id for s in source_sections}

        for i, card in enumerate(cards):
            prefix = f"card[{i}]"

            # Front word count
            front = card.get("front", "")
            front_words = len(front.split()) if front else 0

            if front_words == 0:
                checks.append(
                    ValidatorCheck(
                        name=f"{prefix}.front_empty",
                        passed=False,
                        reason=f"{prefix} front is empty (0 words)",
                        severity="error",
                    )
                )
            elif front_words < MIN_FRONT_WORDS:
                checks.append(
                    ValidatorCheck(
                        name=f"{prefix}.front_short",
                        passed=False,
                        reason=f"{prefix} front has {front_words} words (min {MIN_FRONT_WORDS})",
                        severity="warning",
                    )
                )
            elif front_words > MAX_FRONT_WORDS:
                checks.append(
                    ValidatorCheck(
                        name=f"{prefix}.front_long",
                        passed=False,
                        reason=f"{prefix} front has {front_words} words (max {MAX_FRONT_WORDS})",
                        severity="warning",
                    )
                )
            else:
                checks.append(
                    ValidatorCheck(
                        name=f"{prefix}.front_length",
                        passed=True,
                        reason=f"{prefix} front OK ({front_words} words)",
                        severity="info",
                    )
                )

            # Back word count
            back = card.get("back", "")
            back_words = len(back.split()) if back else 0

            if back_words == 0:
                checks.append(
                    ValidatorCheck(
                        name=f"{prefix}.back_empty",
                        passed=False,
                        reason=f"{prefix} back is empty (0 words)",
                        severity="error",
                    )
                )
            elif back_words < MIN_BACK_WORDS:
                checks.append(
                    ValidatorCheck(
                        name=f"{prefix}.back_short",
                        passed=False,
                        reason=f"{prefix} back has {back_words} words (min {MIN_BACK_WORDS})",
                        severity="warning",
                    )
                )
            elif back_words > MAX_BACK_WORDS:
                checks.append(
                    ValidatorCheck(
                        name=f"{prefix}.back_long",
                        passed=False,
                        reason=f"{prefix} back has {back_words} words (max {MAX_BACK_WORDS})",
                        severity="warning",
                    )
                )
            else:
                checks.append(
                    ValidatorCheck(
                        name=f"{prefix}.back_length",
                        passed=True,
                        reason=f"{prefix} back OK ({back_words} words)",
                        severity="info",
                    )
                )

            # Supporting section IDs
            section_ids = card.get("supportingSectionIds", [])
            if not section_ids:
                checks.append(
                    ValidatorCheck(
                        name=f"{prefix}.missing_section_ids",
                        passed=False,
                        reason=f"{prefix} has no supportingSectionIds",
                        severity="warning",
                    )
                )
            else:
                for sid in section_ids:
                    if sid not in valid_section_ids:
                        checks.append(
                            ValidatorCheck(
                                name=f"{prefix}.invalid_section_id",
                                passed=False,
                                reason=f"{prefix} section {sid} not in source sections",
                                severity="warning",
                            )
                        )

        return self._compute_verdict(checks)

    def _compute_verdict(
        self, checks: list[ValidatorCheck],
    ) -> DerivativeValidationResult:
        errors = [c for c in checks if not c.passed and c.severity == "error"]
        warnings = [c for c in checks if not c.passed and c.severity == "warning"]
        reasons = [c.reason for c in checks if not c.passed]

        if errors:
            verdict = DerivativeVerdict.QUARANTINE
        elif warnings:
            verdict = DerivativeVerdict.HUMAN_REVIEW
        else:
            verdict = DerivativeVerdict.PUBLISH

        return DerivativeValidationResult(
            verdict=verdict,
            checks=checks,
            reasons=reasons,
        )


register_validator("flashcard", FlashcardValidator())
