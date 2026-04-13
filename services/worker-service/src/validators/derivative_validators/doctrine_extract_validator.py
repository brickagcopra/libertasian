"""DoctrineExtractValidator — validates doctrine extraction output against §4.4 v1 thresholds."""

from __future__ import annotations

import re

from . import (
    DerivativeValidationResult,
    DerivativeVerdict,
    LegalDocumentSectionSnapshot,
    LegalDocumentSnapshot,
    ValidatorCheck,
    register_validator,
)

VALID_DOCTRINE_TYPES = {"rule", "test", "definition", "exception", "procedural"}
MAX_DOCTRINES_PER_DOCUMENT = 5
MAX_RELATED_LINKS_PER_DOCTRINE = 3
MIN_DOCTRINE_WORDS = 20
MAX_DOCTRINE_WORDS = 500
# Verbatim match: edit distance <= 5 chars per 100 source chars
VERBATIM_DRIFT_RATIO = 0.05


class DoctrineExtractValidator:
    """Validates doctrine extraction output."""

    def validate(
        self,
        *,
        derivative_type: str,
        content: dict,
        source_document: LegalDocumentSnapshot,
        source_sections: list[LegalDocumentSectionSnapshot],
    ) -> DerivativeValidationResult:
        checks: list[ValidatorCheck] = []
        doctrines = content.get("doctrines", [])

        # 0. Abstain check
        if content.get("abstain"):
            checks.append(ValidatorCheck(
                name="abstain_flag",
                passed=False,
                reason=f"Model abstained: {content.get('abstainReason', 'no reason')}",
                severity="error",
            ))
            return self._compute_verdict(checks)

        # 1. Must have at least one doctrine (unless abstaining)
        if not doctrines:
            checks.append(ValidatorCheck(
                name="doctrines_present",
                passed=False,
                reason="No doctrines extracted",
                severity="error",
            ))
            return self._compute_verdict(checks)

        # 2. Fanout cap: <= 5 doctrines
        checks.append(ValidatorCheck(
            name="fanout_cap",
            passed=len(doctrines) <= MAX_DOCTRINES_PER_DOCUMENT,
            reason=f"Doctrine count {len(doctrines)} (max {MAX_DOCTRINES_PER_DOCUMENT})",
            severity="warning",  # over-extraction -> human_review, not quarantine
        ))

        # Build section text map for verbatim matching
        section_texts = {
            s.id: _normalize_whitespace(s.plain_text)
            for s in source_sections
            if s.plain_text
        }

        for i, doctrine in enumerate(doctrines):
            prefix = f"doctrine_{i}"

            # 3. Doctrine type in allow-list
            dtype = doctrine.get("doctrineType", "")
            checks.append(ValidatorCheck(
                name=f"{prefix}_type",
                passed=dtype in VALID_DOCTRINE_TYPES,
                reason=f"Doctrine type '{dtype}' {'valid' if dtype in VALID_DOCTRINE_TYPES else 'not in allow-list'}",
                severity="error",
            ))

            # 4. Text length: 20-500 words
            text = doctrine.get("text", "")
            word_count = len(text.split()) if text else 0
            checks.append(ValidatorCheck(
                name=f"{prefix}_text_length",
                passed=MIN_DOCTRINE_WORDS <= word_count <= MAX_DOCTRINE_WORDS,
                reason=f"Doctrine text {word_count} words (expected {MIN_DOCTRINE_WORDS}-{MAX_DOCTRINE_WORDS})",
                severity="warning" if word_count > 0 else "error",
            ))

            # 5. Verbatim source text present
            verbatim = doctrine.get("verbatimSourceText", "")
            if not verbatim:
                checks.append(ValidatorCheck(
                    name=f"{prefix}_verbatim_present",
                    passed=False,
                    reason="Missing verbatimSourceText",
                    severity="error",
                ))
            else:
                # 6. Verbatim match against source sections
                match_found = _check_verbatim_match(verbatim, section_texts)
                checks.append(ValidatorCheck(
                    name=f"{prefix}_verbatim_match",
                    passed=match_found,
                    reason=f"Verbatim text {'found' if match_found else 'NOT found'} in source sections (drift threshold {VERBATIM_DRIFT_RATIO * 100}%)",
                    severity="warning",  # forces human_review, not quarantine
                ))

            # 7. Section ID valid
            section_id = doctrine.get("sectionId")
            if section_id:
                valid_section = section_id in section_texts
                checks.append(ValidatorCheck(
                    name=f"{prefix}_section_valid",
                    passed=valid_section,
                    reason=f"Section {str(section_id)[:8]}... {'exists' if valid_section else 'not found'}",
                    severity="warning",
                ))

            # 8. Related doctrine links cap: <= 3
            related = doctrine.get("relatedDoctrines", [])
            if isinstance(related, list):
                checks.append(ValidatorCheck(
                    name=f"{prefix}_related_cap",
                    passed=len(related) <= MAX_RELATED_LINKS_PER_DOCTRINE,
                    reason=f"Related links {len(related)} (max {MAX_RELATED_LINKS_PER_DOCTRINE})",
                    severity="warning",
                ))

        return self._compute_verdict(checks)

    @staticmethod
    def _compute_verdict(checks: list[ValidatorCheck]) -> DerivativeValidationResult:
        errors = [c for c in checks if not c.passed and c.severity == "error"]
        warnings = [c for c in checks if not c.passed and c.severity == "warning"]
        if errors:
            return DerivativeValidationResult(
                verdict=DerivativeVerdict.QUARANTINE, checks=checks,
                reasons=[c.reason for c in errors],
            )
        elif warnings:
            return DerivativeValidationResult(
                verdict=DerivativeVerdict.HUMAN_REVIEW, checks=checks,
                reasons=[c.reason for c in warnings],
            )
        return DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH, checks=checks,
            reasons=[],
        )


def _normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _check_verbatim_match(verbatim: str, section_texts: dict[str, str]) -> bool:
    """Check if verbatim text exists in any source section within drift threshold."""
    normalized_verbatim = _normalize_whitespace(verbatim)
    if not normalized_verbatim:
        return False
    for section_text in section_texts.values():
        if normalized_verbatim in section_text:
            return True
        # Also check with a fuzzy substring match using drift ratio
        max_drift = max(1, int(len(normalized_verbatim) * VERBATIM_DRIFT_RATIO))
        if _fuzzy_substring_match(normalized_verbatim, section_text, max_drift):
            return True
    return False


def _fuzzy_substring_match(needle: str, haystack: str, max_edits: int) -> bool:
    """Simple check: if the needle appears in the haystack with at most
    max_edits character differences.
    Uses a sliding window approach for efficiency on short needles."""
    if len(needle) > len(haystack):
        return False
    window = len(needle)
    for start in range(len(haystack) - window + 1):
        candidate = haystack[start:start + window]
        edits = sum(1 for a, b in zip(needle, candidate) if a != b)
        if edits <= max_edits:
            return True
    return False


# Register at import time
register_validator("doctrine_extract", DoctrineExtractValidator())
