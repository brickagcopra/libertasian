"""Pure metric functions over run results. No I/O, no network.

Authority matching works at the DOCUMENT level: ``/answer`` sources carry a
title, a citation string and a document type, not the article or section a
passage came from. So ``{"statute": "Family Code Art. 36"}`` is a hit when a
Family Code document is among the top-k sources; the article locator is kept
in the golden set for the human reviewer but cannot be checked here.
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from .model import QuestionResult, SourceRecord

DEFAULT_KS: tuple[int, ...] = (1, 3, 8)

# ---------------------------------------------------------------------------
# G.R. number normalisation
# ---------------------------------------------------------------------------

# Mirrors services/worker-service/src/normalizers/text_normalizer.py
# ``normalize_gr_no`` byte-for-byte (evals must not import across services).
# If that function changes, change this one and its test in the same PR.
_WORKER_GR_PATTERN = r"(?i)\bG\.?\s*R\.?\s*(?:No\.?\s*)?(\d[\d\-]+)"


def normalize_gr_no(text: str) -> str:
    """Normalize G.R. No. variations (GR, G.R., GRN...) to 'G.R. No. XXXXXX'."""
    return re.sub(_WORKER_GR_PATTERN, lambda m: f"G.R. No. {m.group(1)}", text)


# Matching-only extension of the worker pattern. The worker regex does not
# accept the plural "G.R. Nos." used for consolidated cases, nor the pre-1987
# "L-" prefix (G.R. No. L-63915): both are common in citation strings, and a
# golden entry for Tañada v. Tuvera must be matchable. This regex is used only
# to derive comparison keys, never to rewrite text.
_GR_KEY_PATTERN = re.compile(
    r"(?i)\bG\.?\s*R\.?\s*(?:Nos?\.?\s*)?(L\s*-?\s*)?(\d+)(?:[\d\-]*)"
)


def gr_keys(text: str) -> set[str]:
    """Primary-number keys for every G.R. number in ``text``.

    ``G.R. No. 146710-15`` and ``G.R. Nos. 146710-15`` both key to ``146710``;
    ``G.R. No. L-63915`` keys to ``L-63915`` (kept distinct from a modern
    ``63915``). Consolidated suffixes after the first hyphen are ignored.
    """
    keys: set[str] = set()
    for m in _GR_KEY_PATTERN.finditer(normalize_gr_no(text)):
        keys.add(("L-" if m.group(1) else "") + m.group(2))
    return keys


def first_gr_no(*texts: str) -> str | None:
    """Canonical 'G.R. No. X' for the first G.R. number found, else None."""
    for text in texts:
        m = _GR_KEY_PATTERN.search(normalize_gr_no(text))
        if m:
            return f"G.R. No. {'L-' if m.group(1) else ''}{m.group(2)}"
    return None


# ---------------------------------------------------------------------------
# Statute / title matching
# ---------------------------------------------------------------------------


def fold(text: str) -> str:
    """Casefold, strip accents, collapse punctuation/whitespace to single spaces."""
    decomposed = unicodedata.normalize("NFKD", text)
    no_marks = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", no_marks.casefold()).strip()


# (kind, pattern) — order matters: "Rep. Act No." must win over bare "Act No.".
_NUM = r"\s*(?:No\.?\s*)?(\d+)"
_INSTRUMENT_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("ra", re.compile(r"(?i)\b(?:R\.?\s*A\.?|Rep\.?\s*Act|Republic\s+Act)" + _NUM)),
    ("pd", re.compile(r"(?i)\b(?:P\.?\s*D\.?|Pres\.?\s*Decree|Presidential\s+Decree)" + _NUM)),
    ("eo", re.compile(r"(?i)\b(?:E\.?\s*O\.?|Exec\.?\s*Order|Executive\s+Order)" + _NUM)),
    ("bp", re.compile(r"(?i)\b(?:B\.?\s*P\.?|Batas\s+Pambansa)\s*(?:Blg\.?\s*|No\.?\s*)?(\d+)")),
    ("am", re.compile(r"(?i)\bA\.?\s*M\.?\s*(?:No\.?\s*)?(\d[\d\-]*(?:-?SC)?)")),
    # Runs last, after the RA/PD/EO matches have been blanked out (see below).
    ("act", re.compile(r"(?i)\bAct\s+(?:No\.?\s*)?(\d+)")),
)


def instrument_numbers(text: str) -> set[tuple[str, str]]:
    """``{("ra", "9262"), ...}`` for every numbered instrument named in ``text``."""
    found: set[tuple[str, str]] = set()
    consumed = text
    for kind, pattern in _INSTRUMENT_PATTERNS:
        for m in pattern.finditer(consumed):
            number = m.group(1).upper()
            if kind == "am":
                # "A.M. No. 02-8-13-SC" and "A.M. No. 02-8-13" are the same issuance.
                number = re.sub(r"-?SC$", "", number).rstrip("-")
            found.add((kind, number))
        # Blank matches out so "Rep. Act No. 386" is not re-read as "Act No. 386".
        consumed = pattern.sub(lambda m: " " * len(m.group(0)), consumed)
    return found


# A locator starts where the instrument name ends: "Family Code | Art. 36".
_LOCATOR = re.compile(r"\s(?:Art\.|Arts\.|Article|Sec\.|Secs\.|Section|Rule)\s")


def statute_instrument(statute: str) -> str:
    """The instrument part of a statute reference ("Family Code Art. 36" -> "Family Code")."""
    m = _LOCATOR.search(f" {statute} ")
    return statute[: max(m.start() - 1, 0)].strip() if m else statute.strip()


def _source_text(source: SourceRecord) -> str:
    return f"{source.title} {source.citation}"


def statute_matches(statute: str, source: SourceRecord) -> bool:
    instrument = statute_instrument(statute)
    if not instrument:
        return False
    text = _source_text(source)
    wanted_numbers = instrument_numbers(instrument)
    if wanted_numbers:
        # A numbered instrument matches by number only: a phrase fallback would
        # let "Act No. 386" hit "Rep. Act No. 386".
        return bool(wanted_numbers & instrument_numbers(text))
    folded = fold(instrument)
    return bool(folded) and f" {folded} " in f" {fold(text)} "


def authority_matches(authority: dict[str, str], source: SourceRecord) -> bool:
    for kind, value in authority.items():
        if kind == "gr_no":
            wanted = gr_keys(value)
            have = gr_keys(_source_text(source))
            if source.gr_no:
                have |= gr_keys(source.gr_no)
            if wanted & have:
                return True
        elif kind == "statute":
            if statute_matches(value, source):
                return True
        elif kind == "title_contains":
            # Whole-word match, so "Lim" never hits "Limitation".
            needle = fold(value)
            if needle and f" {needle} " in f" {fold(source.title)} ":
                return True
    return False


def authority_hit_at_k(
    expected: Sequence[dict[str, str]], sources: Sequence[SourceRecord], k: int
) -> bool:
    """True when ANY expected authority matches ANY of the top-k sources."""
    if k < 1:
        raise ValueError("k must be >= 1")
    top = sources[:k]
    return any(authority_matches(a, s) for a in expected for s in top)


# ---------------------------------------------------------------------------
# Aggregates
# ---------------------------------------------------------------------------


def _ratio(num: int, den: int) -> float | None:
    return num / den if den else None


def percentile(values: Iterable[float], q: float) -> float | None:
    """Linear-interpolated percentile (numpy's default), ``q`` in [0, 100]."""
    data = sorted(values)
    if not data:
        return None
    if not 0 <= q <= 100:
        raise ValueError("q must be in [0, 100]")
    pos = (len(data) - 1) * q / 100
    lo, hi = math.floor(pos), math.ceil(pos)
    return data[lo] + (data[hi] - data[lo]) * (pos - lo)


def answerable(results: Iterable[QuestionResult]) -> list[QuestionResult]:
    return [r for r in results if not r.must_abstain]


def hit_rate_at_k(results: Sequence[QuestionResult], k: int) -> float | None:
    """Share of answerable, non-errored questions with an authority hit in top-k.

    An abstention on an answerable question counts as a miss when it returned
    no sources; if it still returned sources they are scored — retrieval found
    the authority even if the pipeline then declined to answer.
    """
    pool = [r for r in answerable(results) if r.status != "error"]
    hits = sum(authority_hit_at_k(r.expected_authorities, r.sources, k) for r in pool)
    return _ratio(hits, len(pool))


def answer_rate(results: Sequence[QuestionResult]) -> float | None:
    pool = [r for r in answerable(results) if r.status != "error"]
    return _ratio(sum(r.status == "answered" for r in pool), len(pool))


@dataclass(frozen=True)
class AbstentionScores:
    precision: float | None
    recall: float | None
    true_positive: int
    false_positive: int
    false_negative: int


def abstention_scores(results: Sequence[QuestionResult]) -> AbstentionScores:
    """Precision/recall of abstaining, with ``must_abstain`` as the positive class."""
    pool = [r for r in results if r.status != "error"]
    tp = sum(r.must_abstain and r.status == "abstained" for r in pool)
    fp = sum((not r.must_abstain) and r.status == "abstained" for r in pool)
    fn = sum(r.must_abstain and r.status == "answered" for r in pool)
    return AbstentionScores(
        precision=_ratio(tp, tp + fp),
        recall=_ratio(tp, tp + fn),
        true_positive=tp,
        false_positive=fp,
        false_negative=fn,
    )


def citation_validity_rate(results: Sequence[QuestionResult]) -> float | None:
    """Valid citations / all citations, over answered questions."""
    answered = [r for r in results if r.status == "answered"]
    valid = sum(r.citations_valid for r in answered)
    return _ratio(valid, sum(r.citations_total for r in answered))


def latency_percentiles(results: Sequence[QuestionResult]) -> tuple[float | None, float | None]:
    lat = [r.latency_ms for r in results if r.status != "error"]
    return percentile(lat, 50), percentile(lat, 95)


def summarize(
    results: Sequence[QuestionResult], ks: Sequence[int] = DEFAULT_KS
) -> dict[str, object]:
    """Flat, JSON-serialisable summary. Rates are ``None`` when undefined."""
    ab = abstention_scores(results)
    p50, p95 = latency_percentiles(results)
    out: dict[str, object] = {
        "n": len(results),
        "n_answerable": len(answerable(results)),
        "n_must_abstain": sum(r.must_abstain for r in results),
        "n_error": sum(r.status == "error" for r in results),
        "n_degraded": sum(bool(r.degraded_legs) for r in results),
        "answer_rate": answer_rate(results),
        "abstention_precision": ab.precision,
        "abstention_recall": ab.recall,
        "citation_validity_rate": citation_validity_rate(results),
        "latency_p50_ms": p50,
        "latency_p95_ms": p95,
    }
    for k in ks:
        out[f"authority_hit@{k}"] = hit_rate_at_k(results, k)
    return out


def per_subject(
    results: Sequence[QuestionResult], ks: Sequence[int] = DEFAULT_KS
) -> dict[str, dict[str, object]]:
    subjects = sorted({r.subject for r in results})
    return {s: summarize([r for r in results if r.subject == s], ks) for s in subjects}


def format_rate(value: object) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, float):
        return f"{value:.3f}"
    return str(value)


def summary_markdown(
    results: Sequence[QuestionResult], ks: Sequence[int] = DEFAULT_KS
) -> str:
    """Overall + per-subject tables, for printing after a run."""
    overall = summarize(results, ks)
    lines = ["| metric | value |", "|---|---|"]
    lines += [f"| {k} | {format_rate(v)} |" for k, v in overall.items()]
    hit_cols = [f"authority_hit@{k}" for k in ks]
    lines += [
        "",
        "| subject | n | answer_rate | " + " | ".join(hit_cols) + " |",
        "|---|---|---|" + "---|" * len(hit_cols),
    ]
    for subject, s in per_subject(results, ks).items():
        cells = [format_rate(s[c]) for c in hit_cols]
        lines.append(
            f"| {subject} | {s['n']} | {format_rate(s['answer_rate'])} | "
            + " | ".join(cells)
            + " |"
        )
    return "\n".join(lines)
