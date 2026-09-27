"""Diff two result files written by ``evals.run``.

    python -m evals.compare BASELINE.json CANDIDATE.json [--k 3]

Prints a Markdown table of metric deltas (overall and per subject), then the
questions that flipped between the runs: authority hit@k gained/lost and
answered <-> abstained. Metrics are recomputed from the per-question results,
so files written by an older harness still compare on today's definitions.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from .metrics import DEFAULT_KS, authority_hit_at_k, format_rate, per_subject, summarize
from .model import QuestionResult, load_results


def _delta(before: object, after: object) -> str:
    if isinstance(before, int | float) and isinstance(after, int | float):
        diff = float(after) - float(before)
        if isinstance(before, int) and isinstance(after, int):
            return f"{int(diff):+d}"
        return f"{diff:+.3f}"
    return "n/a"


def metric_table(
    before: dict[str, object], after: dict[str, object], title: str = "metric"
) -> list[str]:
    lines = [f"| {title} | baseline | candidate | delta |", "|---|---|---|---|"]
    keys = list(before) + [k for k in after if k not in before]
    for key in keys:
        b, a = before.get(key), after.get(key)
        lines.append(f"| {key} | {format_rate(b)} | {format_rate(a)} | {_delta(b, a)} |")
    return lines


def _hit(r: QuestionResult, k: int) -> bool:
    return (
        not r.must_abstain
        and r.status != "error"
        and authority_hit_at_k(r.expected_authorities, r.sources, k)
    )


def flips(
    baseline: Sequence[QuestionResult], candidate: Sequence[QuestionResult], k: int
) -> dict[str, list[str]]:
    """Question ids that changed state, keyed by transition name.

    Only ids present in both runs are compared; errored runs are skipped for
    the hit transitions so an outage does not masquerade as a regression.
    """
    before = {r.id: r for r in baseline}
    out: dict[str, list[str]] = {
        f"hit@{k} -> miss": [],
        f"miss -> hit@{k}": [],
        "answered -> abstained": [],
        "abstained -> answered": [],
        "ok -> error": [],
        "error -> ok": [],
    }
    for new in candidate:
        old = before.get(new.id)
        if old is None:
            continue
        if old.status != "error" and new.status == "error":
            out["ok -> error"].append(new.id)
        elif old.status == "error" and new.status != "error":
            out["error -> ok"].append(new.id)
        if old.status != "error" and new.status != "error" and not new.must_abstain:
            h_old, h_new = _hit(old, k), _hit(new, k)
            if h_old and not h_new:
                out[f"hit@{k} -> miss"].append(new.id)
            elif h_new and not h_old:
                out[f"miss -> hit@{k}"].append(new.id)
        if old.status == "answered" and new.status == "abstained":
            out["answered -> abstained"].append(new.id)
        elif old.status == "abstained" and new.status == "answered":
            out["abstained -> answered"].append(new.id)
    return out


def compare_markdown(
    baseline: Sequence[QuestionResult],
    candidate: Sequence[QuestionResult],
    *,
    k: int = 3,
    baseline_name: str = "baseline",
    candidate_name: str = "candidate",
) -> str:
    ks = sorted(set(DEFAULT_KS) | {k})
    lines = [f"## RAG eval: `{baseline_name}` -> `{candidate_name}`", ""]
    lines += metric_table(summarize(baseline, ks), summarize(candidate, ks))
    lines += ["", f"### Per subject (authority_hit@{k}, answer_rate)", ""]
    lines += [
        "| subject | hit baseline | hit candidate | delta | answer baseline "
        "| answer candidate | delta |",
        "|---|---|---|---|---|---|---|",
    ]
    subj_b, subj_c = per_subject(baseline, ks), per_subject(candidate, ks)
    hit_key = f"authority_hit@{k}"
    for subject in sorted(subj_b.keys() | subj_c.keys()):
        b, c = subj_b.get(subject, {}), subj_c.get(subject, {})
        lines.append(
            f"| {subject} | {format_rate(b.get(hit_key))} | {format_rate(c.get(hit_key))} "
            f"| {_delta(b.get(hit_key), c.get(hit_key))} "
            f"| {format_rate(b.get('answer_rate'))} | {format_rate(c.get('answer_rate'))} "
            f"| {_delta(b.get('answer_rate'), c.get('answer_rate'))} |"
        )
    lines += ["", "### Flipped questions", ""]
    any_flip = False
    for name, ids in flips(baseline, candidate, k).items():
        if ids:
            any_flip = True
            lines.append(f"- **{name}** ({len(ids)}): {', '.join(ids)}")
    if not any_flip:
        lines.append("- none")
    only_b = sorted({r.id for r in baseline} - {r.id for r in candidate})
    only_c = sorted({r.id for r in candidate} - {r.id for r in baseline})
    if only_b or only_c:
        lines += ["", f"_Not compared — only in baseline: {only_b or '[]'}; "
                  f"only in candidate: {only_c or '[]'}_"]
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m evals.compare", description="Diff two evals.run result files."
    )
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--k", type=int, default=3, help="k for hit flips (default 3)")
    args = parser.parse_args(argv)
    _, base = load_results(args.baseline)
    _, cand = load_results(args.candidate)
    sys.stdout.write(
        compare_markdown(
            base,
            cand,
            k=args.k,
            baseline_name=args.baseline.name,
            candidate_name=args.candidate.name,
        )
        + "\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
