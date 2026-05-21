"""Static integrity checks for the codal seed list.

These tests do NOT hit the network or the database — they just verify
the shape of ``SEED_CODALS`` so a refactor can't silently invalidate the
list (e.g. by introducing a subject code that doesn't match
``apps/api/prisma/seed-bar-subjects.ts``).
"""

from __future__ import annotations

from urllib.parse import urlparse

from src.tasks.seed_codals_task import (
    SEED_CODALS,
    _parse_sections,
    _SECTION_MARKER_RE,
)


# Bar subject codes from apps/api/prisma/seed-bar-subjects.ts. If this
# list ever drifts from the TS seed, the prod tag-map lookup will fail
# silently — keeping the union here makes the drift loud at test time.
_VALID_BAR_SUBJECTS = {
    "civil_law",
    "commercial_law",
    "criminal_law",
    "labor_law",
    "political_law",
    "public_international_law",
    "remedial_law",
    "taxation_law",
    "legal_ethics",
}


def test_seed_codals_list_is_non_empty() -> None:
    assert len(SEED_CODALS) >= 1


def test_all_urls_are_lawphil_apex_not_www() -> None:
    """Lawphil's www subdomain has an expired cert — see ``lawphil.py``."""
    for codal in SEED_CODALS:
        host = urlparse(codal.url).hostname
        assert host == "lawphil.net", (
            f"{codal.short_title}: hostname must be lawphil.net "
            f"(no www, no other host) — got {host!r}"
        )


def test_all_subject_codes_match_bar_subjects_seed() -> None:
    """Primary and secondary subject codes must be in the TS seed list."""
    for codal in SEED_CODALS:
        assert codal.primary_subject in _VALID_BAR_SUBJECTS, (
            f"{codal.short_title}: primary_subject "
            f"{codal.primary_subject!r} not in seed-bar-subjects.ts"
        )
        for code in codal.secondary_subjects:
            assert code in _VALID_BAR_SUBJECTS, (
                f"{codal.short_title}: secondary_subject {code!r} "
                "not in seed-bar-subjects.ts"
            )


def test_citation_document_type_pairs_are_unique() -> None:
    """Idempotency keys must not collide within the seed list itself."""
    pairs = [(c.citation_text, c.document_type) for c in SEED_CODALS]
    assert len(pairs) == len(set(pairs))


def test_section_marker_regex_matches_common_codal_labels() -> None:
    for label in [
        "ARTICLE 1",
        "Article 100",
        "TITLE I",
        "CHAPTER II",
        "Section 3",
        "RULE 14",
        "BOOK ONE",  # Won't match — "ONE" is not in [\dIVXLC]+
    ]:
        if label == "BOOK ONE":
            assert _SECTION_MARKER_RE.match(label) is None
        else:
            assert _SECTION_MARKER_RE.match(label) is not None, label


def test_parse_sections_fallback_to_single_section_on_unstructured_html() -> None:
    """A page with no markers must yield exactly one fallback section."""
    html = "<html><body><p>Some random codal text without markers.</p></body></html>"
    sections = _parse_sections(html)
    assert len(sections) == 1
    assert sections[0].section_label == "Full Text"
    assert "Some random codal text" in sections[0].plain_text


def test_parse_sections_splits_on_bold_marker() -> None:
    html = """
    <html><body>
      <p><b>ARTICLE 1</b></p>
      <p>This is article one body text.</p>
      <p><b>ARTICLE 2</b></p>
      <p>This is article two body text.</p>
    </body></html>
    """
    sections = _parse_sections(html)
    assert len(sections) == 2
    assert sections[0].section_type == "article"
    assert sections[0].section_label.startswith("ARTICLE 1")
    assert "article one body" in sections[0].plain_text
    assert "article two body" in sections[1].plain_text
