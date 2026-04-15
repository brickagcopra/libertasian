"""CaseDigestValidator — validates case_digest contentJson against section 4.4 v1 thresholds."""

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


class CaseDigestValidator:
    """Validates case digest output against structural and quality rules."""

    # v1 thresholds (committed defaults, refine after golden set in Phase 4)
    IRAC_FIELDS = ["facts", "issues", "ruling", "doctrine", "dispositive"]
    FACTS_MIN_WORDS = 80
    FACTS_MAX_WORDS = 1000
    ISSUES_MIN = 1
    ISSUES_MAX = 8
    RULING_MIN_WORDS = 100
    RULING_MAX_WORDS = 1500
    DOCTRINE_MIN_WORDS = 30
    DOCTRINE_MAX_WORDS = 400
    DISPOSITIVE_MIN_WORDS = 10
    DISPOSITIVE_MAX_WORDS = 300
    CITATION_RESOLUTION_THRESHOLD = 0.6  # 60% of cited authorities must resolve
    CONFIDENCE_THRESHOLD = 0.5

    def validate(
        self,
        *,
        derivative_type: str,
        content: dict[str, Any],
        source_document: LegalDocumentSnapshot,
        source_sections: list[LegalDocumentSectionSnapshot],
    ) -> DerivativeValidationResult:
        checks: list[ValidatorCheck] = []

        # 1. Structural: all five IRAC fields present
        for field_name in self.IRAC_FIELDS:
            present = bool(content.get(field_name))
            checks.append(
                ValidatorCheck(
                    name=f"irac_field_{field_name}",
                    passed=present,
                    reason=f"IRAC field '{field_name}' is {'present' if present else 'missing'}",
                    severity="error",
                )
            )

        # 2. Word count checks (only if field is present)
        checks.extend(
            self._check_word_count(content, "facts", self.FACTS_MIN_WORDS, self.FACTS_MAX_WORDS)
        )
        checks.extend(
            self._check_word_count(
                content, "ruling", self.RULING_MIN_WORDS, self.RULING_MAX_WORDS
            )
        )
        checks.extend(
            self._check_word_count(
                content, "doctrine", self.DOCTRINE_MIN_WORDS, self.DOCTRINE_MAX_WORDS
            )
        )
        checks.extend(
            self._check_word_count(
                content,
                "dispositive",
                self.DISPOSITIVE_MIN_WORDS,
                self.DISPOSITIVE_MAX_WORDS,
            )
        )

        # 3. Issues count (list of strings)
        issues = content.get("issues", [])
        if isinstance(issues, list):
            count = len(issues)
            checks.append(
                ValidatorCheck(
                    name="issues_count",
                    passed=self.ISSUES_MIN <= count <= self.ISSUES_MAX,
                    reason=f"Issues count {count} (expected {self.ISSUES_MIN}-{self.ISSUES_MAX})",
                    severity="error" if count == 0 else "warning",
                )
            )

        # 4. Cited authority resolution check
        # NOTE: actual citation resolution (looking up LegalDocument IDs) happens
        # at the NestJS write path. Here we just check structural completeness.
        # RAG returns cited_authorities: [{citation_text, document_type, gr_no}]
        cited = content.get("cited_authorities", [])
        if isinstance(cited, list):
            for i, c in enumerate(cited):
                has_text = bool(c.get("citation_text"))
                checks.append(
                    ValidatorCheck(
                        name=f"citation_{i}_complete",
                        passed=has_text,
                        reason=f"Citation {i}: text={'yes' if has_text else 'no'}",
                        severity="warning",
                    )
                )

        # 5. Provenance: RAG returns [{field, source_section_id, source_document_id}]
        provenance = content.get("provenance", [])
        section_ids_in_provenance: set[str] = set()
        fields_covered: set[str] = set()
        if isinstance(provenance, list):
            for entry in provenance:
                if not isinstance(entry, dict):
                    continue
                field = entry.get("field")
                sid = entry.get("source_section_id")
                if field:
                    fields_covered.add(field)
                if sid:
                    section_ids_in_provenance.add(sid)

        for field_name in ["facts", "issues", "ruling", "doctrine"]:
            covered = field_name in fields_covered
            checks.append(
                ValidatorCheck(
                    name=f"provenance_{field_name}",
                    passed=covered,
                    reason=f"Provenance for '{field_name}': {'covered' if covered else 'missing'}",
                    severity="warning",  # forces human_review, not quarantine
                )
            )

        # 6. Section IDs referenced must exist in source_sections
        valid_section_ids = {s.id for s in source_sections}
        for sid in section_ids_in_provenance:
            exists = sid in valid_section_ids
            checks.append(
                ValidatorCheck(
                    name=f"section_exists_{sid[:8]}",
                    passed=exists,
                    reason=f"Section {sid[:8]}... {'exists' if exists else 'not found in source'}",
                    severity="warning",
                )
            )

        # 7. Confidence score from RAG
        confidence = content.get("confidence_score", 0)
        checks.append(
            ValidatorCheck(
                name="confidence_threshold",
                passed=isinstance(confidence, (int, float))
                and confidence >= self.CONFIDENCE_THRESHOLD,
                reason=f"Confidence {confidence} (threshold {self.CONFIDENCE_THRESHOLD})",
                severity="warning",
            )
        )

        # 8. Abstain check
        if content.get("abstain"):
            checks.append(
                ValidatorCheck(
                    name="abstain_flag",
                    passed=False,
                    reason=f"Model abstained: {content.get('abstainReason', 'no reason')}",
                    severity="error",
                )
            )

        # Compute verdict
        return self._compute_verdict(checks)

    def _check_word_count(
        self, content: dict[str, Any], field: str, min_w: int, max_w: int
    ) -> list[ValidatorCheck]:
        text = content.get(field)
        if not text or not isinstance(text, str):
            return []
        count = len(text.split())
        in_range = min_w <= count <= max_w
        severity = "error" if count == 0 else "warning"
        return [
            ValidatorCheck(
                name=f"{field}_word_count",
                passed=in_range,
                reason=f"{field}: {count} words (expected {min_w}-{max_w})",
                severity=severity,
            )
        ]

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
        else:
            return DerivativeValidationResult(
                verdict=DerivativeVerdict.PUBLISH,
                checks=checks,
                reasons=[],
            )


# Register at module import time
register_validator("case_digest", CaseDigestValidator())
