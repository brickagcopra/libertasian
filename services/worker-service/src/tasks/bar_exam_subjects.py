"""LIBERTASIAN Worker Service — Past bar exam subject-slug registry.

Maps LawPhil URL slug → study/admin taxonomy codes plus a human label.
Two distinct slug eras live side-by-side because LawPhil renamed several
files in 2022 when the bar exam was first split into morning/afternoon
parts (Civil Law I/II, Remedial Law I/II) under Justice Caguioa's reform.

The (year, slug) → archive URL mapping is:

    https://lawphil.net/courts/bm/barQ/<year>/<slug>.html

The full backfill enumeration walks ``ALL_YEAR_SLUGS`` so the same code
that re-fetches one sitting can also re-fetch the entire archive in
one pass.

Years 2019, 2020, and 2021 are intentionally absent — LawPhil's index
page does not list them. The 2020 bar was cancelled outright due to
COVID-19, and the 2021 cohort sat the November 2022 examinations.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BarSubjectMeta:
    """Per-slug metadata for a single bar exam paper."""

    study_code: str
    admin_code: str
    part: str | None
    label: str


# Subject metadata is keyed by slug only — two distinct slug families
# (legacy 2006-2018 and 2022) share the same study_code where the
# subject substantively overlaps.
SUBJECT_REGISTRY: dict[str, BarSubjectMeta] = {
    # Legacy slugs (2006-2018): single-paper subjects.
    "ethicQ": BarSubjectMeta(
        study_code="legal_ethics",
        admin_code="remedial_ethics_practical",
        part=None,
        label="Legal Ethics and Practical Exercises",
    ),
    # 2015-only alias: that year's ethics paper is named legalQ.html on
    # LawPhil instead of ethicQ.html. Same content classification.
    "legalQ": BarSubjectMeta(
        study_code="legal_ethics",
        admin_code="remedial_ethics_practical",
        part=None,
        label="Legal Ethics and Practical Exercises",
    ),
    "remedialQ": BarSubjectMeta(
        study_code="remedial_law",
        admin_code="remedial_ethics_practical",
        part=None,
        label="Remedial Law",
    ),
    "criminalQ": BarSubjectMeta(
        study_code="criminal_law",
        admin_code="criminal",
        part=None,
        label="Criminal Law",
    ),
    "mercanQ": BarSubjectMeta(
        study_code="mercantile_law",
        admin_code="commercial_taxation",
        part=None,
        label="Mercantile Law",
    ),
    "civilQ": BarSubjectMeta(
        study_code="civil_law",
        admin_code="civil_land_titles",
        part=None,
        label="Civil Law",
    ),
    "taxQ": BarSubjectMeta(
        study_code="taxation",
        admin_code="commercial_taxation",
        part=None,
        label="Taxation Law",
    ),
    "laborQ": BarSubjectMeta(
        study_code="labor_law",
        admin_code="labor_social",
        part=None,
        label="Labor Law and Social Legislation",
    ),
    "poliQ": BarSubjectMeta(
        study_code="political_law",
        admin_code="political_pil",
        part=None,
        label="Political Law and International Law",
    ),

    # 2022-format slugs (split papers, new naming).
    "remedial-I_Q": BarSubjectMeta(
        study_code="remedial_law",
        admin_code="remedial_ethics_practical",
        part="I",
        label="Remedial Law I",
    ),
    "remedial-II_Q": BarSubjectMeta(
        study_code="remedial_law",
        admin_code="remedial_ethics_practical",
        part="II",
        label="Remedial Law II",
    ),
    "civil-I_Q": BarSubjectMeta(
        study_code="civil_law",
        admin_code="civil_land_titles",
        part="I",
        label="Civil Law I",
    ),
    "civil-II_Q": BarSubjectMeta(
        study_code="civil_law",
        admin_code="civil_land_titles",
        part="II",
        label="Civil Law II",
    ),
    "comlawQ": BarSubjectMeta(
        study_code="mercantile_law",
        admin_code="commercial_taxation",
        part=None,
        label="Commercial Law",
    ),
}


# Year-coverage table. Each (year, slug) entry maps to a single LawPhil
# archive page that exists today. Years not on LawPhil are omitted —
# 2019, 2020, 2021 are not in the archive.

_LEGACY_SLUGS_2006_2018: tuple[str, ...] = (
    "ethicQ",
    "remedialQ",
    "criminalQ",
    "mercanQ",
    "civilQ",
    "taxQ",
    "laborQ",
    "poliQ",
)

# 2015 swapped ethicQ → legalQ — only that year. All other 2015 slugs match.
_YEAR_2015_SLUGS: tuple[str, ...] = tuple(
    "legalQ" if s == "ethicQ" else s for s in _LEGACY_SLUGS_2006_2018
)

_YEAR_2022_SLUGS: tuple[str, ...] = (
    "remedial-I_Q",
    "remedial-II_Q",
    "civil-I_Q",
    "civil-II_Q",
    "criminalQ",
    "comlawQ",
    "poliQ",
    "laborQ",
)

# Years carrying the standard 8-paper layout — every year 2006-2018 except
# 2015. 2015 has its own slug list because of the legalQ/ethicQ rename.
_LEGACY_YEARS: tuple[int, ...] = (2006, 2007, 2008, 2009, 2010, 2011, 2012,
                                  2013, 2014, 2016, 2017, 2018)


def _build_year_slug_index() -> tuple[tuple[int, str], ...]:
    rows: list[tuple[int, str]] = []
    for year in _LEGACY_YEARS:
        for slug in _LEGACY_SLUGS_2006_2018:
            rows.append((year, slug))
    for slug in _YEAR_2015_SLUGS:
        rows.append((2015, slug))
    for slug in _YEAR_2022_SLUGS:
        rows.append((2022, slug))
    return tuple(rows)


ALL_YEAR_SLUGS: tuple[tuple[int, str], ...] = _build_year_slug_index()
"""All (year, slug) combinations LawPhil has archived as of 2026."""


LAWPHIL_BAR_BASE_URL = "https://lawphil.net/courts/bm/barQ"
TAXONOMY_VERSION = "study_8"


def archive_url_for(year: int, slug: str) -> str:
    """Return the canonical LawPhil archive URL for a (year, slug) pair."""
    return f"{LAWPHIL_BAR_BASE_URL}/{year}/{slug}.html"


def get_subject_meta(slug: str) -> BarSubjectMeta | None:
    """Look up subject metadata by slug; ``None`` if unknown."""
    return SUBJECT_REGISTRY.get(slug)


__all__ = [
    "ALL_YEAR_SLUGS",
    "BarSubjectMeta",
    "LAWPHIL_BAR_BASE_URL",
    "SUBJECT_REGISTRY",
    "TAXONOMY_VERSION",
    "archive_url_for",
    "get_subject_meta",
]
