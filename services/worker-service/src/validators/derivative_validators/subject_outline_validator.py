"""SubjectOutlineValidator — validates subject outline output per §4.4.

Subject outlines write to DerivativeArtifact with derivativeType='subject_outline'
and hierarchical contentJson. This validator checks:
- Section count: 3–30
- Each section has non-empty heading and at least one paragraph
- Cross-document coverage: if outline spans multiple source documents, at least
  2 distinct sources cited
- Sub-sections: non-empty headings, at least one paragraph each
- Topic code format validation (actual DB resolution happens at write time)
"""

from __future__ import annotations

import re
from typing import Any

from . import (
    DerivativeValidationResult,
    DerivativeVerdict,
    LegalDocumentSectionSnapshot,
    LegalDocumentSnapshot,
    ValidatorCheck,
    register_validator,
)

MIN_SECTIONS = 3
MAX_SECTIONS = 30

# Simple pattern for topic codes (e.g., "civil_law.obligations_contracts")
TOPIC_CODE_PATTERN = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$")


class SubjectOutlineValidator:
    """Validates subject outline generation output."""

    def validate(
        self,
        *,
        derivative_type: str,
        content: dict[str, Any],
        source_document: LegalDocumentSnapshot,
        source_sections: list[LegalDocumentSectionSnapshot],
    ) -> DerivativeValidationResult:
        checks: list[ValidatorCheck] = []
        sections = content.get("sections", [])

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

        # --- Section count ---
        section_count = len(sections)

        if section_count < MIN_SECTIONS:
            checks.append(
                ValidatorCheck(
                    name="section_count_min",
                    passed=False,
                    reason=f"{section_count} sections (min {MIN_SECTIONS})",
                    severity="error",
                )
            )
        elif section_count > MAX_SECTIONS:
            checks.append(
                ValidatorCheck(
                    name="section_count_max",
                    passed=False,
                    reason=f"{section_count} sections (max {MAX_SECTIONS})",
                    severity="warning",
                )
            )
        else:
            checks.append(
                ValidatorCheck(
                    name="section_count",
                    passed=True,
                    reason=f"{section_count} sections within range",
                    severity="info",
                )
            )

        # --- Per-section checks ---
        all_cited_section_ids: set[str] = set()
        valid_section_ids = {s.id for s in source_sections}
        # Map section IDs to document IDs (all sections share source_document)
        # For multi-doc outlines, source_sections come from multiple documents
        # We'll track which source documents are cited via section membership

        for i, section in enumerate(sections):
            prefix = f"section[{i}]"

            # Non-empty heading
            heading = section.get("heading", "")
            if not heading or not heading.strip():
                checks.append(
                    ValidatorCheck(
                        name=f"{prefix}.empty_heading",
                        passed=False,
                        reason=f"{prefix} has empty heading",
                        severity="error",
                    )
                )

            # At least one paragraph
            paragraphs = section.get("paragraphs", [])
            if not paragraphs:
                checks.append(
                    ValidatorCheck(
                        name=f"{prefix}.no_paragraphs",
                        passed=False,
                        reason=f"{prefix} has no paragraphs",
                        severity="error",
                    )
                )

            # Collect cited section IDs
            cited = section.get("citedSectionIds", [])
            all_cited_section_ids.update(cited)

            # Topic code format (if present)
            topic_code = section.get("subjectTopicCode")
            if topic_code:
                if not TOPIC_CODE_PATTERN.match(topic_code):
                    checks.append(
                        ValidatorCheck(
                            name=f"{prefix}.invalid_topic_code",
                            passed=False,
                            reason=f"{prefix} topic code '{topic_code}' has invalid format",
                            severity="warning",
                        )
                    )

            # Sub-sections
            sub_sections = section.get("subSections", [])
            for j, sub in enumerate(sub_sections):
                sub_prefix = f"{prefix}.sub[{j}]"

                sub_heading = sub.get("heading", "")
                if not sub_heading or not sub_heading.strip():
                    checks.append(
                        ValidatorCheck(
                            name=f"{sub_prefix}.empty_heading",
                            passed=False,
                            reason=f"{sub_prefix} has empty heading",
                            severity="warning",
                        )
                    )

                sub_paragraphs = sub.get("paragraphs", [])
                if not sub_paragraphs:
                    checks.append(
                        ValidatorCheck(
                            name=f"{sub_prefix}.no_paragraphs",
                            passed=False,
                            reason=f"{sub_prefix} has no paragraphs",
                            severity="warning",
                        )
                    )

                sub_cited = sub.get("citedSectionIds", [])
                all_cited_section_ids.update(sub_cited)

        # --- Cross-document coverage ---
        # Determine how many distinct source documents are cited.
        # source_sections may come from multiple documents — we need a mapping.
        # Since LegalDocumentSectionSnapshot doesn't carry document_id, we use
        # valid_section_ids as all belonging to source_document. If the outline
        # task provides sections from multiple documents, we check via section
        # membership (sections not in valid_section_ids are from other documents).
        #
        # For the validator, we count cited IDs that ARE in valid_section_ids
        # as "source doc 1", and any that AREN'T as "other documents". If there
        # are sections from multiple source documents in source_sections,
        # that inherently provides multi-doc coverage.
        if len(source_sections) > 0 and all_cited_section_ids:
            cited_in_source = all_cited_section_ids & valid_section_ids
            cited_outside = all_cited_section_ids - valid_section_ids
            # Count distinct document origins: at minimum 1 (source doc)
            distinct_sources = 0
            if cited_in_source:
                distinct_sources += 1
            if cited_outside:
                distinct_sources += 1

            if distinct_sources < 2 and len(source_sections) > 1:
                # Only warn if there were multiple source sections (implying
                # multi-doc was expected)
                checks.append(
                    ValidatorCheck(
                        name="cross_doc_coverage",
                        passed=False,
                        reason=f"Only {distinct_sources} source document(s) cited (recommend >= 2)",
                        severity="warning",
                    )
                )
            else:
                checks.append(
                    ValidatorCheck(
                        name="cross_doc_coverage",
                        passed=True,
                        reason=f"{distinct_sources} source document(s) cited",
                        severity="info",
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


register_validator("subject_outline", SubjectOutlineValidator())
