"""Static integrity checks for the codal seed list.

These tests do NOT hit the network or the database — they just verify
the shape of ``SEED_CODALS`` so a refactor can't silently invalidate the
list (e.g. by introducing a subject code that doesn't match
``apps/api/prisma/seed-bar-subjects.ts``).
"""

from __future__ import annotations

from urllib.parse import urlparse

from src.tasks.seed_codals_task import (
    _SECTION_MARKER_RE,
    _TEXT_SECTION_MARKER_RE,
    SEED_CODALS,
    _filter_codals_by_document_types,
    _parse_document_types_arg,
    _parse_sections,
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


def test_filter_by_document_types_selects_eo_and_pd_entries() -> None:
    """``--document-types executive_order,presidential_decree`` must yield
    exactly the EO + PD entries from the live seed list.

    This guards the targeted-crawl path used to import only the
    executive issuances added in feature/codal-executive-issuances
    without touching pre-existing constitution / codal / RA /
    rules_of_court rows.
    """
    document_types = _parse_document_types_arg(
        "executive_order,presidential_decree",
    )
    assert document_types == {"executive_order", "presidential_decree"}

    filtered = _filter_codals_by_document_types(SEED_CODALS, document_types)
    # The pre-existing Family Code (EO 209) and Labor Code (PD 442)
    # entries use document_type="codal", NOT executive_order/
    # presidential_decree — so they MUST NOT appear in the filtered
    # result. The filter is on document_type, not on the citation prefix.
    actual_pairs = {(c.document_type, c.citation_text) for c in filtered}
    expected_pairs = {
        ("executive_order", "Exec. Order No. 292 (1987)"),
        ("executive_order", "Exec. Order No. 226 (1987)"),
        ("presidential_decree", "Pres. Decree No. 1529"),
        ("presidential_decree", "Pres. Decree No. 957"),
        ("presidential_decree", "Pres. Decree No. 1083"),
        ("presidential_decree", "Pres. Decree No. 968"),
    }
    assert actual_pairs == expected_pairs, (
        f"unexpected filter result — extra: {actual_pairs - expected_pairs}, "
        f"missing: {expected_pairs - actual_pairs}"
    )
    # No other document_types must leak through.
    assert {c.document_type for c in filtered} == {
        "executive_order",
        "presidential_decree",
    }
    # And the existing codal-typed EO 209 / PD 442 entries are correctly
    # NOT included — the filter is exact-match on document_type.
    assert all(
        c.citation_text not in {"Exec. Order No. 209 (1987)", "Pres. Decree No. 442"}
        for c in filtered
    )


def test_filter_by_document_types_none_returns_full_list_unchanged() -> None:
    """No filter ⇒ identical list (preserves default seeder behavior)."""
    assert _parse_document_types_arg(None) is None
    assert _filter_codals_by_document_types(SEED_CODALS, None) is SEED_CODALS


def test_filter_by_document_types_blank_string_returns_full_list() -> None:
    """Whitespace-only / empty CSV ⇒ no filter (no accidental empty run)."""
    assert _parse_document_types_arg("") is None
    assert _parse_document_types_arg("   ,  ,") is None


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


def test_parse_sections_text_line_fallback_when_markers_only_in_plain_paragraphs() -> None:
    """Lawphil's EO 292 page carries BOOK I / CHAPTER 1 / Section 1. as
    plain <p> text — no heading or <b>/<strong> tags. The tag-driven
    pass misses every marker, so the text-line fallback must step in
    and segment instead of collapsing to one 800KB "Full Text" blob."""
    html = (
        "<html><body>"
        "<p>BOOK I</p><p>Sovereignty and General Principles</p>"
        "<p>Section 1.</p><p>Title.</p>"
        "<p>- text of section one.</p>"
        "<p>Section 2.</p>"
        "<p>- text of section two.</p>"
        "</body></html>"
    )
    sections = _parse_sections(html)
    labels = [s.section_label for s in sections]
    # The single-section "Full Text" fallback would yield exactly one
    # section — assert we got real structure instead.
    assert len(sections) >= 3, f"expected >=3 sections, got {labels}"
    assert any("BOOK I" in label for label in labels), labels
    assert any(label.startswith("Section 1") for label in labels), labels
    assert any(label.startswith("Section 2") for label in labels), labels
    # And the "Full Text" sentinel must NOT appear when real markers were found.
    assert "Full Text" not in labels


def test_text_section_marker_regex_rejects_running_prose_cross_references() -> None:
    """``Section 16 of this Code provides …`` is a cross-reference, not
    a heading. The end-anchored regex MUST NOT match it — otherwise
    every appellate codal that quotes a section would shatter the body
    into nonsense at each citation."""
    cross_refs = [
        "Section 16 of this Code provides the rule.",
        "Article 100 was repealed by RA 8424.",
        "See CHAPTER 2 below for details.",
    ]
    for line in cross_refs:
        assert _TEXT_SECTION_MARKER_RE.match(line) is None, (
            f"running-prose cross-reference must NOT match as a marker: {line!r}"
        )

    # And the bare-marker lines that LawPhil uses MUST still match.
    bare_markers = [
        "BOOK I",
        "CHAPTER 1",
        "Section 1.",
        "Section 2",
        "ARTICLE 100",
        "TITLE III",
        "RULE 14:",
    ]
    for line in bare_markers:
        assert _TEXT_SECTION_MARKER_RE.match(line) is not None, line


def test_rules_of_court_split_into_eleven_per_topic_subpages() -> None:
    """The Rules of Court entry was previously a single CodalSeed pointing
    at the TOC index page ``rc.html``, which has no rule text. It is now
    split into exactly 11 ``document_type="rules_of_court"`` entries —
    one per LawPhil topic sub-page — so the text-line parser can section
    each by ``RULE N``. (Rules 142-143 was dropped after LawPhil began
    404'ing its ``rc_142-143_cost.html`` page.) Guard the split here so a
    refactor can't silently regress to the un-importable TOC entry.
    """
    roc_entries = [c for c in SEED_CODALS if c.document_type == "rules_of_court"]
    assert len(roc_entries) == 11, (
        f"expected exactly 11 rules_of_court entries, got {len(roc_entries)}: "
        f"{[c.short_title for c in roc_entries]}"
    )

    citations = [c.citation_text for c in roc_entries]
    assert len(citations) == len(set(citations)), (
        f"citation_text values must be unique within rules_of_court entries: {citations}"
    )

    # The old TOC index URL must NOT appear — that page has no rule text.
    old_toc_url = "https://lawphil.net/courts/rules/rc.html"
    assert all(c.url != old_toc_url for c in roc_entries), (
        f"old rc.html TOC URL must not be in SEED_CODALS: "
        f"{[c.url for c in roc_entries if c.url == old_toc_url]}"
    )


def test_parse_sections_keeps_single_section_fallback_when_no_markers_at_all() -> None:
    """A page with absolutely no markers (no tag-based, no text-based)
    must still produce the single ``Full Text`` fallback section — the
    text-line pass should yield <2 sections and fall through. This
    pairs with ``test_parse_sections_fallback_to_single_section_on_unstructured_html``
    but specifically guards the *interaction* between the two passes
    after the fix landed."""
    html = (
        "<html><body>"
        "<p>This is paragraph one with no marker line.</p>"
        "<p>And another paragraph.</p>"
        "</body></html>"
    )
    sections = _parse_sections(html)
    assert len(sections) == 1, [s.section_label for s in sections]
    assert sections[0].section_label == "Full Text"


# ---------------------------------------------------------------------------
# Off-by-one regression (prod 2026-09-27): LawPhil puts the marker INSIDE
# the paragraph it opens — ``<p><b>Article 1317.</b> text…</p>``. The parent
# <p> is visited before its child <b>, so the old walk appended Art. 1317's
# first paragraph to the Art. 1316 row. Civil Code c2426740-…, orderings
# 1479/1480, is the reported example.
# ---------------------------------------------------------------------------

_LAWPHIL_INLINE_MARKER_HTML = """
<html><body>
  <p>REPUBLIC ACT NO. 386</p>
  <p align="center"><b>CHAPTER 2<br>Consent</b></p>
  <p><b>Article 1316.</b> Real contracts shall not be perfected until the
     delivery of the object. (n)</p>
  <p><b>Article 1317.</b> No one may contract in the name of another without
     being authorized by the latter.</p>
  <p>A contract entered into in the name of another by one who has no
     authority shall be unenforceable. (1259a)</p>
  <p align="center"><b>CHAPTER 3</b></p>
  <p align="center">Object of Contracts</p>
  <p><font><b>Article 1318.</b></font> There is no contract unless the
     following requisites concur: (1261)</p>
  <p>(1) Consent of the contracting parties;</p>
</body></html>
"""


def test_parse_sections_inline_marker_opens_its_own_paragraph() -> None:
    sections = _parse_sections(_LAWPHIL_INLINE_MARKER_HTML)
    by_label = {s.section_label: s for s in sections}
    assert [s.section_label for s in sections] == [
        "CHAPTER 2 Consent",
        "Article 1316.",
        "Article 1317.",
        "CHAPTER 3",
        "Article 1318.",
    ]
    art_1316 = by_label["Article 1316."].plain_text
    assert art_1316.startswith("Real contracts shall not be perfected")
    # The bug: Art. 1316's row used to END with Art. 1317's first paragraph.
    assert "No one may contract" not in art_1316
    assert "Article 1317" not in art_1316


def test_parse_sections_strips_marker_text_from_body() -> None:
    sections = _parse_sections(_LAWPHIL_INLINE_MARKER_HTML)
    for s in sections:
        assert not s.plain_text.startswith(s.section_label), s


def test_parse_sections_multi_paragraph_article_stays_together() -> None:
    sections = _parse_sections(_LAWPHIL_INLINE_MARKER_HTML)
    art_1317 = next(s for s in sections if s.section_label == "Article 1317.")
    assert art_1317.section_type == "article"
    assert art_1317.plain_text.startswith("No one may contract")
    assert "shall be unenforceable. (1259a)" in art_1317.plain_text
    # Nothing from the CHAPTER heading or the next article leaks in.
    assert "CHAPTER" not in art_1317.plain_text
    assert "Object of Contracts" not in art_1317.plain_text
    assert "requisites" not in art_1317.plain_text


def test_parse_sections_chapter_heading_between_articles() -> None:
    sections = _parse_sections(_LAWPHIL_INLINE_MARKER_HTML)
    chapter_3 = next(s for s in sections if s.section_label == "CHAPTER 3")
    assert chapter_3.section_type == "chapter"
    assert chapter_3.plain_text == "Object of Contracts"
    art_1318 = sections[-1]
    assert art_1318.section_label == "Article 1318."  # marker wrapped in <font>
    assert art_1318.plain_text.startswith("There is no contract unless")
    assert art_1318.plain_text.endswith("(1) Consent of the contracting parties;")


def test_parse_sections_first_marker_paragraph_is_not_dropped() -> None:
    """Before the fix the paragraph opening the FIRST marker was appended
    while no section was open, and lost."""
    html = (
        "<html><body><p>Preamble.</p>"
        "<p><b>Article 1.</b> This Act shall be known as the Civil Code.</p>"
        "<p><b>Article 2.</b> Laws shall take effect after fifteen days.</p>"
        "</body></html>"
    )
    sections = _parse_sections(html)
    assert [(s.section_label, s.plain_text) for s in sections] == [
        ("Article 1.", "This Act shall be known as the Civil Code."),
        ("Article 2.", "Laws shall take effect after fifteen days."),
    ]


def test_parse_sections_mid_paragraph_marker_keeps_old_behaviour() -> None:
    """Only a LEADING marker opens the paragraph's section; a bold marker
    after running text still splits where it sits."""
    html = (
        "<html><body>"
        "<p><b>Section 1.</b> One.</p>"
        "<p>Lead-in text <b>Section 2.</b> two.</p>"
        "</body></html>"
    )
    sections = _parse_sections(html)
    assert [s.section_label for s in sections] == ["Section 1.", "Section 2."]
    assert "Lead-in text" in sections[0].plain_text
