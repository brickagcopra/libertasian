from __future__ import annotations

import re
from pathlib import Path

import pytest

from evals import metrics
from evals.metrics import (
    abstention_scores,
    answer_rate,
    authority_hit_at_k,
    citation_validity_rate,
    first_gr_no,
    gr_keys,
    hit_rate_at_k,
    instrument_numbers,
    latency_percentiles,
    normalize_gr_no,
    per_subject,
    percentile,
    statute_instrument,
    summarize,
    summary_markdown,
)
from evals.model import SourceRecord
from evals.tests.helpers import qr, src

WORKER_NORMALIZER = (
    Path(__file__).resolve().parents[3]
    / "worker-service"
    / "src"
    / "normalizers"
    / "text_normalizer.py"
)

# ---------------------------------------------------------------------------
# G.R. normalisation — must stay in lockstep with the worker normaliser
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("GR 196359", "G.R. No. 196359"),
        ("G.R. 196359", "G.R. No. 196359"),
        ("GR No. 196359", "G.R. No. 196359"),
        ("g.r. no.196359", "G.R. No. 196359"),
        ("G. R. No. 146710-15", "G.R. No. 146710-15"),
        ("Tan-Andal v. Andal, GR No 196359, May 11, 2021",
         "Tan-Andal v. Andal, G.R. No. 196359, May 11, 2021"),
    ],
)
def test_normalize_gr_no_matches_worker_rules(raw: str, expected: str) -> None:
    assert normalize_gr_no(raw) == expected


def test_gr_pattern_is_byte_identical_to_worker() -> None:
    if not WORKER_NORMALIZER.exists():
        pytest.skip("worker-service source not present (e.g. inside the rag image)")
    source = WORKER_NORMALIZER.read_text(encoding="utf-8")
    body = source.split("def normalize_gr_no", 1)[1].split("\ndef ", 1)[0]
    match = re.search(r'pattern = r"([^"]+)"', body)
    assert match is not None, "worker normalize_gr_no no longer uses a `pattern = r\"...\"`"
    assert match.group(1) == metrics._WORKER_GR_PATTERN


@pytest.mark.parametrize(
    ("text", "keys"),
    [
        ("G.R. No. 196359", {"196359"}),
        ("GR 196359", {"196359"}),
        ("G.R. Nos. 147678-87", {"147678"}),
        ("G.R. No. 146710-15", {"146710"}),
        ("G.R. No. L-63915", {"L-63915"}),
        ("G.R. No. L63915", {"L-63915"}),
        ("G.R. Nos. 1234 and G.R. No. 5678", {"1234", "5678"}),
        ("Republic Act No. 386", set()),
    ],
)
def test_gr_keys(text: str, keys: set[str]) -> None:
    assert gr_keys(text) == keys


def test_l_prefixed_and_modern_numbers_do_not_collide() -> None:
    assert gr_keys("G.R. No. L-63915").isdisjoint(gr_keys("G.R. No. 63915"))


def test_first_gr_no_prefers_first_text() -> None:
    assert first_gr_no("GR 1111", "G.R. No. 2222") == "G.R. No. 1111"
    assert first_gr_no("", "Tanada v. Tuvera, G.R. No. L-63915") == "G.R. No. L-63915"
    assert first_gr_no("Rep. Act No. 386") is None


# ---------------------------------------------------------------------------
# Statute / title matching
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("statute", "instrument"),
    [
        ("Family Code Art. 36", "Family Code"),
        ("Rules of Court Rule 65 Sec. 4", "Rules of Court"),
        ("1987 Constitution Art. III Sec. 7", "1987 Constitution"),
        ("R.A. No. 9262 Sec. 26", "R.A. No. 9262"),
        ("Revised Penal Code", "Revised Penal Code"),
    ],
)
def test_statute_instrument(statute: str, instrument: str) -> None:
    assert statute_instrument(statute) == instrument


def test_instrument_numbers_variants() -> None:
    assert instrument_numbers("Rep. Act No. 386") == {("ra", "386")}
    assert instrument_numbers("R.A. No. 9262") == {("ra", "9262")}
    assert instrument_numbers("Republic Act 10963") == {("ra", "10963")}
    assert instrument_numbers("Pres. Decree No. 442") == {("pd", "442")}
    assert instrument_numbers("Exec. Order No. 209 (1987)") == {("eo", "209")}
    assert instrument_numbers("Act No. 3815") == {("act", "3815")}
    assert instrument_numbers("A.M. No. 02-8-13-SC") == {("am", "02-8-13")}
    assert instrument_numbers("A.M. No. 02-8-13") == {("am", "02-8-13")}
    assert instrument_numbers("Batas Pambansa Blg. 129") == {("bp", "129")}


def test_rep_act_is_not_also_read_as_bare_act() -> None:
    assert ("act", "386") not in instrument_numbers("Rep. Act No. 386")


# Real seeded codal rows (worker-service/src/tasks/seed_codals_task.py).
FAMILY_CODE = src("The Family Code of the Philippines", "Exec. Order No. 209 (1987)", "codal")
LABOR_CODE = src("A Decree Instituting a Labor Code", "Pres. Decree No. 442", "codal")
CIVIL_CODE = src(
    "An Act to Ordain and Institute the Civil Code of the Philippines", "Rep. Act No. 386", "codal"
)
RPC = src("The Revised Penal Code", "Act No. 3815", "codal")
CONSTITUTION = src("1987 Constitution of the Philippines", "Const. (1987)", "constitution")
CIVPRO = src(
    "Rules of Court — Civil Procedure (Rules 1-71)", "Rules of Court, Rules 1-71", "rules_of_court"
)


@pytest.mark.parametrize(
    ("statute", "source", "hit"),
    [
        ("Family Code Art. 36", FAMILY_CODE, True),
        ("E.O. No. 209 Art. 36", FAMILY_CODE, True),
        ("Labor Code Art. 295", LABOR_CODE, True),
        ("P.D. No. 442 Art. 295", LABOR_CODE, True),
        ("Civil Code Art. 19", CIVIL_CODE, True),
        ("Civil Code Art. 19", FAMILY_CODE, False),
        ("Act No. 3815 Art. 11", RPC, True),
        ("Revised Penal Code Art. 11", RPC, True),
        ("Act No. 386", CIVIL_CODE, False),
        ("1987 Constitution Art. III Sec. 7", CONSTITUTION, True),
        ("Rules of Court Rule 65 Sec. 4", CIVPRO, True),
        ("Family Code Art. 36", RPC, False),
    ],
)
def test_statute_matching_against_seeded_codals(
    statute: str, source: SourceRecord, hit: bool
) -> None:
    assert authority_hit_at_k([{"statute": statute}], [source], 1) is hit


def test_gr_hit_via_citation_and_title() -> None:
    by_citation = src("Tan-Andal v. Andal", "GR No 196359")
    by_title = src("Tan-Andal v. Andal, G.R. No. 196359", "")
    expected = [{"gr_no": "G.R. No. 196359"}]
    assert authority_hit_at_k(expected, [by_citation], 1)
    assert authority_hit_at_k(expected, [by_title], 1)
    assert not authority_hit_at_k(expected, [src("Other", "G.R. No. 196360")], 1)


def test_title_contains_is_accent_insensitive_and_whole_word() -> None:
    assert authority_hit_at_k([{"title_contains": "Tanada"}], [src("Tañada v. Tuvera")], 1)
    assert not authority_hit_at_k(
        [{"title_contains": "Lim"}], [src("Limitation of Actions")], 1
    )


def test_hit_respects_k() -> None:
    sources = [src("A"), src("B"), src("Neypes v. Court of Appeals", "G.R. No. 141524")]
    expected = [{"gr_no": "G.R. No. 141524"}]
    assert not authority_hit_at_k(expected, sources, 2)
    assert authority_hit_at_k(expected, sources, 3)
    with pytest.raises(ValueError):
        authority_hit_at_k(expected, sources, 0)


def test_any_expected_authority_suffices() -> None:
    expected = [{"gr_no": "G.R. No. 999"}, {"statute": "Family Code Art. 36"}]
    assert authority_hit_at_k(expected, [FAMILY_CODE], 1)


# ---------------------------------------------------------------------------
# Aggregates
# ---------------------------------------------------------------------------


def test_percentile_linear_interpolation() -> None:
    assert percentile([], 50) is None
    assert percentile([5.0], 95) == 5.0
    assert percentile([1.0, 2.0, 3.0, 4.0], 50) == 2.5
    assert percentile([10.0, 20.0, 30.0, 40.0, 50.0], 95) == pytest.approx(48.0)
    with pytest.raises(ValueError):
        percentile([1.0], 101)


def test_answer_rate_ignores_must_abstain_and_errors() -> None:
    results = [
        qr("a", status="answered"),
        qr("b", status="abstained"),
        qr("c", status="error"),
        qr("d", status="abstained", must_abstain=True),
    ]
    assert answer_rate(results) == 0.5
    assert answer_rate([]) is None


def test_abstention_precision_recall() -> None:
    results = [
        qr("tp1", must_abstain=True, status="abstained"),
        qr("tp2", must_abstain=True, status="abstained"),
        qr("fn", must_abstain=True, status="answered"),
        qr("fp", status="abstained"),
        qr("tn", status="answered"),
        qr("err", must_abstain=True, status="error"),
    ]
    s = abstention_scores(results)
    assert (s.true_positive, s.false_positive, s.false_negative) == (2, 1, 1)
    assert s.precision == pytest.approx(2 / 3)
    assert s.recall == pytest.approx(2 / 3)
    empty = abstention_scores([qr("tn", status="answered")])
    assert empty.precision is None and empty.recall is None


def test_citation_validity_counts_answered_only() -> None:
    results = [
        qr("a", citations_total=4, citations_valid=3),
        qr("b", citations_total=1, citations_valid=1),
        qr("c", status="abstained", citations_total=5, citations_valid=0),
    ]
    assert citation_validity_rate(results) == pytest.approx(0.8)
    assert citation_validity_rate([qr("x")]) is None


def test_latency_excludes_errors() -> None:
    results = [qr("a", latency_ms=100), qr("b", latency_ms=300), qr("c", status="error",
                                                                    latency_ms=99999)]
    p50, p95 = latency_percentiles(results)
    assert p50 == 200.0
    assert p95 == pytest.approx(290.0)


def test_hit_rate_skips_errors_and_must_abstain() -> None:
    hit = qr("h", expected=[{"statute": "Family Code"}], sources=[FAMILY_CODE])
    miss = qr("m", expected=[{"statute": "Family Code"}], sources=[RPC])
    err = qr("e", status="error", expected=[{"statute": "Family Code"}])
    abst = qr("x", must_abstain=True, status="abstained", sources=[FAMILY_CODE])
    assert hit_rate_at_k([hit, miss, err, abst], 1) == 0.5


def test_summarize_and_per_subject() -> None:
    results = [
        qr("a", subject="Civil Law", expected=[{"statute": "Family Code"}], sources=[FAMILY_CODE]),
        qr("b", subject="Labor Law", expected=[{"statute": "Labor Code"}], sources=[RPC]),
    ]
    s = summarize(results, ks=(1,))
    assert s["n"] == 2 and s["authority_hit@1"] == 0.5 and s["answer_rate"] == 1.0
    by = per_subject(results, ks=(1,))
    assert by["Civil Law"]["authority_hit@1"] == 1.0
    assert by["Labor Law"]["authority_hit@1"] == 0.0
    md = summary_markdown(results, ks=(1,))
    assert "| Civil Law | 1 | 1.000 | 1.000 |" in md
