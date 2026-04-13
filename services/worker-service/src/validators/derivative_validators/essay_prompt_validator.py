"""EssayPromptValidator — validates essay prompt + model answer output per §4.4 v1 thresholds.

Checks:
- Prompt text length (50-600 words)
- Suggested time (15-90 minutes)
- ALAC headings presence (Answer, Law, Application, Conclusion)
- Per-paragraph citation enforcement in model answer
- Cited section ID validity against source sections
- Rubric criteria count (>= 3), points sum, description non-empty
- Abstain flag handling

Verdicts:
- PUBLISH: all checks pass
- HUMAN_REVIEW: warning-level failures (soft checks)
- QUARANTINE: error-level failures (hard checks, abstain)
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

# Thresholds (§4.4 v1)
MIN_PROMPT_WORDS = 50
MAX_PROMPT_WORDS = 600
MIN_SUGGESTED_TIME = 15
MAX_SUGGESTED_TIME = 90
MIN_RUBRIC_CRITERIA = 3
ALAC_HEADINGS = {"Answer", "Law", "Application", "Conclusion"}


class EssayPromptValidator:
    """Validator for essay_prompt derivative type."""

    def validate(
        self,
        *,
        derivative_type: str,
        content: dict[str, Any],
        source_document: LegalDocumentSnapshot,
        source_sections: list[LegalDocumentSectionSnapshot],
    ) -> DerivativeValidationResult:
        checks: list[ValidatorCheck] = []

        # 0. Abstain
        if content.get("abstain"):
            checks.append(ValidatorCheck(
                name="abstain_flag",
                passed=False,
                reason=f"Model abstained: {content.get('abstainReason', 'no reason')}",
                severity="error",
            ))
            return self._compute_verdict(checks)

        # 1. Prompt text: 50-600 words
        prompt_text = content.get("promptText", "")
        word_count = len(prompt_text.split()) if prompt_text else 0
        checks.append(ValidatorCheck(
            name="prompt_length",
            passed=MIN_PROMPT_WORDS <= word_count <= MAX_PROMPT_WORDS,
            reason=f"Prompt {word_count} words (expected {MIN_PROMPT_WORDS}-{MAX_PROMPT_WORDS})",
            severity="error" if word_count == 0 else "warning",
        ))

        # 2. Suggested time: 15-90 minutes
        time_mins = content.get("suggestedTimeMinutes")
        if time_mins is not None:
            checks.append(ValidatorCheck(
                name="suggested_time",
                passed=MIN_SUGGESTED_TIME <= time_mins <= MAX_SUGGESTED_TIME,
                reason=f"Suggested time {time_mins}m (expected {MIN_SUGGESTED_TIME}-{MAX_SUGGESTED_TIME})",
                severity="warning",
            ))

        # 3. Model answer validation (if present)
        model_answer = content.get("modelAnswer")
        if model_answer:
            sections = model_answer.get("outlineSections", [])

            # 3a. Check ALAC headings are present
            headings = {s.get("heading") for s in sections}
            missing_alac = ALAC_HEADINGS - headings
            if missing_alac:
                checks.append(ValidatorCheck(
                    name="alac_headings",
                    passed=False,
                    reason=f"Missing ALAC headings: {missing_alac}",
                    severity="warning",
                ))
            else:
                checks.append(ValidatorCheck(
                    name="alac_headings",
                    passed=True,
                    reason="All ALAC headings present (Answer, Law, Application, Conclusion)",
                    severity="info",
                ))

            # 3b. Every paragraph must cite at least one section
            valid_section_ids = {s.id for s in source_sections}
            for i, section in enumerate(sections):
                heading = section.get("heading", f"section_{i}")
                paragraphs = section.get("paragraphs", [])
                cited_ids = section.get("citedSectionIds", [])

                for j, para in enumerate(paragraphs):
                    if para and not cited_ids:
                        checks.append(ValidatorCheck(
                            name=f"answer_{heading}_para_{j}_citation",
                            passed=False,
                            reason=f"Paragraph {j} in '{heading}' has no citedSectionIds",
                            severity="warning",
                        ))

                # Validate cited section IDs exist
                for sid in cited_ids:
                    if sid not in valid_section_ids:
                        checks.append(ValidatorCheck(
                            name=f"answer_{heading}_section_{str(sid)[:8]}",
                            passed=False,
                            reason=f"Section {str(sid)[:8]}... not in source",
                            severity="warning",
                        ))

        # 4. Rubric validation (if present)
        rubric = content.get("rubric")
        if rubric:
            total_points = rubric.get("totalPoints", 0)
            criteria = rubric.get("criteria", [])

            # 4a. At least 3 criteria
            checks.append(ValidatorCheck(
                name="rubric_criteria_count",
                passed=len(criteria) >= MIN_RUBRIC_CRITERIA,
                reason=f"Rubric criteria: {len(criteria)} (min {MIN_RUBRIC_CRITERIA})",
                severity="warning",
            ))

            # 4b. maxPoints sum to totalPoints
            points_sum = sum(c.get("maxPoints", 0) for c in criteria)
            checks.append(ValidatorCheck(
                name="rubric_points_sum",
                passed=points_sum == total_points,
                reason=f"Criteria maxPoints sum {points_sum} vs totalPoints {total_points}",
                severity="warning",
            ))

            # 4c. Non-empty descriptions
            for k, c in enumerate(criteria):
                desc = c.get("description", "")
                checks.append(ValidatorCheck(
                    name=f"rubric_criterion_{k}_description",
                    passed=bool(desc and desc.strip()),
                    reason=f"Criterion '{c.get('name', k)}' description {'present' if desc else 'empty'}",
                    severity="warning",
                ))

        return self._compute_verdict(checks)

    @staticmethod
    def _compute_verdict(checks: list[ValidatorCheck]) -> DerivativeValidationResult:
        errors = [c for c in checks if not c.passed and c.severity == "error"]
        warnings = [c for c in checks if not c.passed and c.severity == "warning"]
        if errors:
            return DerivativeValidationResult(
                verdict=DerivativeVerdict.QUARANTINE,
                checks=checks,
                reasons=[c.reason for c in errors],
            )
        elif warnings:
            return DerivativeValidationResult(
                verdict=DerivativeVerdict.HUMAN_REVIEW,
                checks=checks,
                reasons=[c.reason for c in warnings],
            )
        return DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH,
            checks=checks,
            reasons=[],
        )


# Register with the validator dispatch registry
register_validator("essay_prompt", EssayPromptValidator())
