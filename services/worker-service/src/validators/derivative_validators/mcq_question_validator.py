"""McqQuestionValidator — validates MCQ questions per §4.4 v1 thresholds.

KEY DESIGN: Each question is validated independently. The validate() method
returns a per-question result list via content["_per_question_results"].
Passing questions get written; failing ones are logged in the job's errorJson.
This differs from CaseDigest/Doctrine validators which produce a single
verdict for the whole output.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from . import (
    DerivativeValidationResult,
    DerivativeVerdict,
    LegalDocumentSectionSnapshot,
    LegalDocumentSnapshot,
    ValidatorCheck,
    register_validator,
)

VALID_DIFFICULTIES = {"easy", "medium", "hard", "bar_exam_level"}
VALID_LABELS = {"A", "B", "C", "D"}
MIN_STEM_WORDS = 20
MAX_STEM_WORDS = 300
MAX_QUESTIONS_PER_BATCH = 10
LEVENSHTEIN_SIMILARITY_THRESHOLD = 0.85


@dataclass
class McqQuestionValidationResult:
    """Validation result for a single MCQ question."""

    index: int
    passed: bool
    verdict: str  # "publish" | "human_review" | "quarantine"
    checks: list[ValidatorCheck]
    reasons: list[str]


class McqQuestionValidator:
    """Validates MCQ generation output per §4.4."""

    def validate(
        self,
        *,
        derivative_type: str,
        content: dict,
        source_document: LegalDocumentSnapshot,
        source_sections: list[LegalDocumentSectionSnapshot],
    ) -> DerivativeValidationResult:
        """Validate the full batch. Returns aggregate verdict.

        Also populates content["_per_question_results"] with per-question
        validation results for the caller to use when deciding which
        questions to persist.
        """
        checks: list[ValidatorCheck] = []
        questions = content.get("questions", [])

        # Abstain check
        if content.get("abstain"):
            checks.append(ValidatorCheck(
                name="abstain_flag",
                passed=False,
                reason=f"Model abstained: {content.get('abstainReason', 'no reason')}",
                severity="error",
            ))
            return self._compute_verdict(checks)

        # Must have at least one question
        if not questions:
            checks.append(ValidatorCheck(
                name="questions_present",
                passed=False,
                reason="No questions generated",
                severity="error",
            ))
            return self._compute_verdict(checks)

        # Fanout cap
        checks.append(ValidatorCheck(
            name="fanout_cap",
            passed=len(questions) <= MAX_QUESTIONS_PER_BATCH,
            reason=f"Question count {len(questions)} (max {MAX_QUESTIONS_PER_BATCH})",
            severity="warning",
        ))

        valid_section_ids = {s.id for s in source_sections}
        per_question_results: list[McqQuestionValidationResult] = []

        for i, q in enumerate(questions):
            q_checks = self._validate_single_question(q, i, valid_section_ids)
            q_errors = [c for c in q_checks if not c.passed and c.severity == "error"]
            q_warnings = [c for c in q_checks if not c.passed and c.severity == "warning"]

            if q_errors:
                verdict = "quarantine"
                passed = False
            elif q_warnings:
                verdict = "human_review"
                passed = True  # still persisted, just flagged
            else:
                verdict = "publish"
                passed = True

            per_question_results.append(McqQuestionValidationResult(
                index=i,
                passed=passed,
                verdict=verdict,
                checks=q_checks,
                reasons=[c.reason for c in q_checks if not c.passed],
            ))
            checks.extend(q_checks)

        # Store per-question results on content for the caller
        content["_per_question_results"] = per_question_results

        # Aggregate verdict: if ALL questions quarantined -> quarantine batch
        # If any pass -> human_review or publish based on warnings/failures
        passing = [r for r in per_question_results if r.passed]
        failing = [r for r in per_question_results if not r.passed]
        if not passing:
            return DerivativeValidationResult(
                verdict=DerivativeVerdict.QUARANTINE,
                checks=checks,
                reasons=["All questions failed validation"],
            )

        has_warnings = any(
            c for c in checks if not c.passed and c.severity == "warning"
        )
        # If any questions failed, the batch needs human review
        has_failures = len(failing) > 0
        return DerivativeValidationResult(
            verdict=(
                DerivativeVerdict.HUMAN_REVIEW
                if has_warnings or has_failures
                else DerivativeVerdict.PUBLISH
            ),
            checks=checks,
            reasons=[c.reason for c in checks if not c.passed],
        )

    def _validate_single_question(
        self,
        q: dict,
        index: int,
        valid_section_ids: set[str],
    ) -> list[ValidatorCheck]:
        checks: list[ValidatorCheck] = []
        prefix = f"q{index}"

        stem = q.get("questionStem", "")
        options = q.get("options", [])
        explanation = q.get("explanation", "")
        supporting_ids = q.get("supportingSectionIds", [])

        # 1. Stem word count: 20-300
        word_count = len(stem.split()) if stem else 0
        checks.append(ValidatorCheck(
            name=f"{prefix}_stem_length",
            passed=MIN_STEM_WORDS <= word_count <= MAX_STEM_WORDS,
            reason=f"Stem {word_count} words (expected {MIN_STEM_WORDS}-{MAX_STEM_WORDS})",
            severity="error" if word_count == 0 else "warning",
        ))

        # 2. Stem ends with ? or completion blank
        stem_ok = bool(
            stem
            and (
                stem.rstrip().endswith("?")
                or "___" in stem
                or stem.rstrip().endswith(".")
            )
        )
        checks.append(ValidatorCheck(
            name=f"{prefix}_stem_format",
            passed=stem_ok,
            reason=f"Stem {'ends with ?/blank' if stem_ok else 'does not end with ? or completion blank'}",
            severity="warning",
        ))

        # 3. No stray HTML
        has_html = bool(re.search(r"<[a-zA-Z][^>]*>", stem))
        checks.append(ValidatorCheck(
            name=f"{prefix}_no_html",
            passed=not has_html,
            reason=f"Stem {'contains' if has_html else 'no'} HTML tags",
            severity="warning",
        ))

        # 4. Exactly 4 options with labels A-D
        labels = {o.get("label") for o in options} if isinstance(options, list) else set()
        checks.append(ValidatorCheck(
            name=f"{prefix}_option_count",
            passed=len(options) == 4 and labels == VALID_LABELS,
            reason=f"Options: {len(options)} with labels {sorted(labels)}",
            severity="error",
        ))

        # 5. Exactly one correct option
        correct_count = (
            sum(1 for o in options if o.get("isCorrect"))
            if isinstance(options, list)
            else 0
        )
        checks.append(ValidatorCheck(
            name=f"{prefix}_one_correct",
            passed=correct_count == 1,
            reason=f"Correct options: {correct_count} (expected 1)",
            severity="error",
        ))

        # 6. Stem leakage: correct option text not substring of stem
        correct_options = (
            [o for o in options if o.get("isCorrect")]
            if isinstance(options, list)
            else []
        )
        if correct_options and stem:
            correct_text = correct_options[0].get("text", "")
            # Only check if correct text is reasonably long (>10 chars) to avoid false positives
            leaks = len(correct_text) > 10 and correct_text.lower() in stem.lower()
            checks.append(ValidatorCheck(
                name=f"{prefix}_stem_leakage",
                passed=not leaks,
                reason=f"Correct answer {'leaked in' if leaks else 'not leaked in'} stem",
                severity="warning",
            ))

        # 7. Distractor quality: Levenshtein similarity <= 0.85 vs correct
        if correct_options and isinstance(options, list):
            correct_text = correct_options[0].get("text", "")
            for o in options:
                if o.get("isCorrect"):
                    continue
                distractor_text = o.get("text", "")
                sim = _levenshtein_similarity(correct_text, distractor_text)
                label = o.get("label", "?")
                checks.append(ValidatorCheck(
                    name=f"{prefix}_distractor_{label}_quality",
                    passed=sim <= LEVENSHTEIN_SIMILARITY_THRESHOLD,
                    reason=f"Distractor {label} similarity {sim:.2f} (threshold {LEVENSHTEIN_SIMILARITY_THRESHOLD})",
                    severity="warning",
                ))

        # 8. Explanation non-empty
        checks.append(ValidatorCheck(
            name=f"{prefix}_explanation",
            passed=bool(explanation and len(explanation.strip()) > 0),
            reason=f"Explanation {'present' if explanation else 'missing'}",
            severity="error",
        ))

        # 9. Supporting section IDs: >= 1 and valid
        checks.append(ValidatorCheck(
            name=f"{prefix}_supporting_sections",
            passed=bool(supporting_ids) and len(supporting_ids) >= 1,
            reason=f"Supporting section IDs: {len(supporting_ids)}",
            severity="warning",
        ))
        for sid in supporting_ids or []:
            if sid not in valid_section_ids:
                checks.append(ValidatorCheck(
                    name=f"{prefix}_section_{str(sid)[:8]}",
                    passed=False,
                    reason=f"Section {str(sid)[:8]}... not in source",
                    severity="warning",
                ))

        return checks

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


def _levenshtein_similarity(s1: str, s2: str) -> float:
    """Compute normalized Levenshtein similarity (1.0 = identical, 0.0 = completely different)."""
    if not s1 and not s2:
        return 1.0
    if not s1 or not s2:
        return 0.0
    s1, s2 = s1.lower(), s2.lower()
    if s1 == s2:
        return 1.0
    len1, len2 = len(s1), len(s2)
    max_len = max(len1, len2)
    # Simple Levenshtein distance via dynamic programming
    matrix = list(range(len2 + 1))
    for i in range(1, len1 + 1):
        prev = matrix[0]
        matrix[0] = i
        for j in range(1, len2 + 1):
            temp = matrix[j]
            if s1[i - 1] == s2[j - 1]:
                matrix[j] = prev
            else:
                matrix[j] = 1 + min(prev, matrix[j], matrix[j - 1])
            prev = temp
    distance = matrix[len2]
    return 1.0 - (distance / max_len)


# Register at import time
register_validator("mcq_question", McqQuestionValidator())
