#!/usr/bin/env python3
"""Benchmark reranker-service against rag-service's real request shape.

Why this is committed rather than a throwaway: the reranker shipped functionally
correct and operationally useless — 11.2-11.5s to score 30 passages against
rag-service's 10s `reranker_timeout`, so every call fell back to RRF while every
health check stayed green. Latency IS a correctness property for this service,
and it is not covered by the unit tests, which mock the model.

Two things are measured, and both matter:

  * **Wall clock**, at the exact fan-out rag-service produces (`top_k * 2` = 30
    candidates, each truncated to 1000 characters by `core/reranking.py`).
  * **Score spread**, because the optimisations that buy latency —
    `max_length=256` and int8 quantization — buy it by discarding information.
    A fast reranker whose scores have collapsed into a narrow band ranks no
    better than the RRF it replaced, and it does so invisibly.

Usage:
    python scripts/bench_reranker.py --url http://localhost:18002 --key testkey
    python scripts/bench_reranker.py --passages 30 --runs 5

Exits non-zero if p95 exceeds --max-p95, so it can gate a deploy.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.error
import urllib.request

# Realistic Philippine legal prose. rag-service truncates to 1000 characters
# before sending, so these are padded to that length — benchmarking on short
# strings would measure the wrong thing entirely.
_BODIES = [
    "Estafa under Article 315 of the Revised Penal Code is committed by any person who "
    "defrauds another by abuse of confidence or by means of deceit, causing damage capable "
    "of pecuniary estimation. The elements are a false pretense or fraudulent representation, "
    "made prior to or simultaneously with the commission of the fraud, reliance thereon by the "
    "offended party, and resulting damage. ",
    "The writ of amparo is a remedy available to any person whose right to life, liberty and "
    "security is violated or threatened with violation by an unlawful act or omission of a "
    "public official or employee, or of a private individual or entity. The petition shall be "
    "filed on any day and at any time with the Regional Trial Court of the place where the "
    "threat, act or omission was committed or any of its elements occurred. ",
    "Article III of the 1987 Constitution, the Bill of Rights. No person shall be deprived of "
    "life, liberty, or property without due process of law, nor shall any person be denied the "
    "equal protection of the laws. The right of the people to be secure in their persons, "
    "houses, papers, and effects against unreasonable searches and seizures of whatever nature "
    "and for any purpose shall be inviolable. ",
    "Theft is committed by any person who, with intent to gain but without violence against or "
    "intimidation of persons nor force upon things, takes personal property of another without "
    "the latter's consent. The elements are the taking of personal property, that the property "
    "belongs to another, that the taking was done with intent to gain, that it was without the "
    "owner's consent, and that it was accomplished without violence. ",
    "The doctrine of stare decisis et non quieta movere enjoins adherence to judicial "
    "precedents. Once a question of law has been examined and decided, it should be deemed "
    "settled and closed to further argument. The doctrine is grounded on the necessity for "
    "securing certainty and stability of judicial decisions, and rests on the desirability of "
    "having like cases decided alike. ",
    "Jesus is Lord Christian School Foundation, Inc. v. Municipality of Pasig. Petition "
    "concerning expropriation proceedings, the required deposit, and whether the trial court "
    "gravely abused its discretion in issuing a writ of possession before the deposit was made "
    "in accordance with the applicable rules on eminent domain. ",
]

_QUERY = "What is estafa under Philippine law?"
_TARGET_CHARS = 1000  # matches core/reranking.py's truncation


def _passage(index: int) -> dict[str, str]:
    body = _BODIES[index % len(_BODIES)]
    padded = (body * ((_TARGET_CHARS // len(body)) + 1))[:_TARGET_CHARS]
    return {"id": f"bench-{index:03d}", "text": padded}


def _post(url: str, key: str, payload: dict[str, object], timeout: float) -> dict[str, object]:
    request = urllib.request.Request(  # noqa: S310 - fixed internal URL
        f"{url.rstrip('/')}/rerank",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "X-Internal-Api-Key": key},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
        result: dict[str, object] = json.loads(response.read())
        return result


def _health(url: str, timeout: float) -> dict[str, object]:
    with urllib.request.urlopen(  # noqa: S310
        f"{url.rstrip('/')}/health", timeout=timeout
    ) as response:
        result: dict[str, object] = json.loads(response.read())
        return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8002")
    parser.add_argument("--key", default="", help="X-Internal-Api-Key")
    parser.add_argument("--passages", type=int, default=30, help="rag-service sends top_k*2")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument(
        "--max-p95",
        type=float,
        default=None,
        help="Exit non-zero if p95 exceeds this many seconds.",
    )
    args = parser.parse_args()

    try:
        health = _health(args.url, timeout=10.0)
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"ERROR: cannot reach {args.url}/health — {exc}", file=sys.stderr)
        return 2

    print("=" * 78)
    print("reranker-service benchmark")
    print("=" * 78)
    for field in ("model_name", "model_loaded", "torch_threads", "max_length", "quantized"):
        if field in health:
            print(f"  {field:<16} {health[field]}")
    print(f"  {'passages':<16} {args.passages}")
    print(f"  {'runs':<16} {args.runs}")
    print()

    payload = {
        "query": _QUERY,
        "passages": [_passage(i) for i in range(args.passages)],
    }

    timings: list[float] = []
    last_scores: list[float] = []

    for run in range(1, args.runs + 1):
        started = time.perf_counter()
        try:
            body = _post(args.url, args.key, payload, timeout=args.timeout)
        except (urllib.error.URLError, TimeoutError) as exc:
            print(f"  run {run}: FAILED — {exc}", file=sys.stderr)
            return 2
        elapsed = time.perf_counter() - started
        timings.append(elapsed)

        results = body.get("results", [])
        assert isinstance(results, list)
        last_scores = [float(r["score"]) for r in results]
        print(f"  run {run}: {elapsed:7.3f}s   ({len(results)} scored)")

    ordered = sorted(timings)
    p50 = statistics.median(ordered)
    # Nearest-rank p95: with 5 runs this is the slowest, which is the honest
    # reading of a small sample — no interpolation pretending to precision.
    p95 = ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))]

    print()
    print(f"  p50 {p50:7.3f}s")
    print(f"  p95 {p95:7.3f}s")
    print(f"  min {min(ordered):7.3f}s   max {max(ordered):7.3f}s")

    print()
    print("SCORE DISTRIBUTION (the optimisations must not flatten this)")
    if last_scores:
        lo, hi = min(last_scores), max(last_scores)
        median = statistics.median(last_scores)
        spread = (hi / lo) if lo > 0 else float("inf")
        print(f"  min      {lo:.6g}")
        print(f"  median   {median:.6g}")
        print(f"  max      {hi:.6g}")
        print(f"  spread   {spread:.1f}x  (max/min)")
        print(f"  in 0-1   {all(0.0 <= s <= 1.0 for s in last_scores)}")

    if args.max_p95 is not None and p95 > args.max_p95:
        print(f"\nFAIL: p95 {p95:.3f}s exceeds budget {args.max_p95:.3f}s", file=sys.stderr)
        return 1

    print("\nOK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
