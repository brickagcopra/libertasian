"""Run the golden set against a live rag-service and write a result file.

    python -m evals.run --base-url http://localhost:8000 \\
        --api-key "$RAG_INTERNAL_API_KEY" --endpoint answer \\
        --out /tmp/rag-evals/<ts>.json [--limit N] [--concurrency 2]

Talks to the INTERNAL rag-service API (the one NestJS calls), authenticated
with the ``X-Internal-Api-Key`` header checked by ``src/shared/auth.py``.
Endpoints are pluggable via ``ENDPOINTS`` so ``--endpoint deep`` can be added
alongside ``answer`` without touching the runner.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import httpx

from .metrics import DEFAULT_KS, first_gr_no, summarize, summary_markdown
from .model import (
    GOLDEN_PATH,
    GoldenEntry,
    QuestionResult,
    SourceRecord,
    load_golden,
)

API_KEY_HEADER = "X-Internal-Api-Key"
API_KEY_ENV = "RAG_INTERNAL_API_KEY"
RESULTS_DIR = Path(__file__).resolve().parent / "results"


@dataclass(frozen=True)
class ParsedResponse:
    """Endpoint-agnostic view of one response."""

    abstained: bool
    abstain_reason: str | None
    sources: list[SourceRecord]
    citations_total: int
    citations_valid: int
    model_name: str
    degraded_legs: list[str]
    confidence: float | None
    intent: str | None


@dataclass(frozen=True)
class Endpoint:
    """How to call one rag-service route and read its response.

    To add Deep Research: define ``build_deep_payload``/``parse_deep_response``
    and register ``"deep": Endpoint(path=..., ...)`` in ``ENDPOINTS``.
    """

    name: str
    path: str
    build_payload: Callable[[GoldenEntry], dict[str, object]]
    parse_response: Callable[[object], ParsedResponse]


# ---------------------------------------------------------------------------
# /answer  (src/answer/schemas.py: AnswerRequest / AnswerResponse)
# ---------------------------------------------------------------------------


def build_answer_payload(entry: GoldenEntry) -> dict[str, object]:
    # organization_id/user_id are omitted: the eval measures the public corpus,
    # never a tenant's private uploads. max_passages=8 is the CLAUDE.md default.
    return {"query": entry.question, "max_passages": 8, "include_sources": True}


def _as_dict(value: object) -> dict[str, object]:
    return {str(k): v for k, v in value.items()} if isinstance(value, dict) else {}


def _as_list(value: object) -> list[object]:
    return list(value) if isinstance(value, list) else []


def _opt_float(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def parse_answer_response(body: object) -> ParsedResponse:
    data = _as_dict(body)
    sources: list[SourceRecord] = []
    for raw in _as_list(data.get("sources")):
        s = _as_dict(raw)
        title = str(s.get("title") or "")
        citation = str(s.get("citation_text") or "")
        sources.append(
            SourceRecord(
                title=title,
                citation=citation,
                gr_no=first_gr_no(citation, title),
                document_type=str(s.get("document_type") or ""),
                rerank_score=_opt_float(s.get("rerank_score")),
                document_id=str(s.get("document_id") or ""),
            )
        )
    citations = [_as_dict(c) for c in _as_list(data.get("citations"))]
    reason = data.get("abstention_reason")
    intent = data.get("intent")
    return ParsedResponse(
        abstained=data.get("abstained") is True,
        abstain_reason=reason if isinstance(reason, str) else None,
        sources=sources,
        citations_total=len(citations),
        citations_valid=sum(c.get("valid") is True for c in citations),
        model_name=str(data.get("model_name") or ""),
        degraded_legs=[str(x) for x in _as_list(data.get("degraded_legs"))],
        confidence=_opt_float(data.get("confidence")),
        intent=intent if isinstance(intent, str) else None,
    )


ENDPOINTS: Mapping[str, Endpoint] = {
    "answer": Endpoint(
        name="answer",
        path="/answer",
        build_payload=build_answer_payload,
        parse_response=parse_answer_response,
    ),
}


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


def _base_result(entry: GoldenEntry) -> QuestionResult:
    return QuestionResult(
        id=entry.id,
        subject=entry.subject,
        must_abstain=entry.must_abstain,
        expected_authorities=[a.to_json() for a in entry.expected_authorities],
        status="error",
    )


async def evaluate_one(
    client: httpx.AsyncClient, endpoint: Endpoint, entry: GoldenEntry
) -> QuestionResult:
    result = _base_result(entry)
    started = time.perf_counter()
    try:
        response = await client.post(endpoint.path, json=endpoint.build_payload(entry))
    except httpx.HTTPError as exc:
        result.latency_ms = (time.perf_counter() - started) * 1000
        result.error = f"{type(exc).__name__}: {exc}"
        return result
    result.latency_ms = (time.perf_counter() - started) * 1000
    result.http_status = response.status_code
    if response.status_code != 200:
        result.error = f"HTTP {response.status_code}: {response.text[:300]}"
        return result
    try:
        parsed = endpoint.parse_response(response.json())
    except ValueError as exc:
        result.error = f"unparseable response: {exc}"
        return result
    result.status = "abstained" if parsed.abstained else "answered"
    result.abstain_reason = parsed.abstain_reason
    result.sources = parsed.sources
    result.citations_total = parsed.citations_total
    result.citations_valid = parsed.citations_valid
    result.model_name = parsed.model_name
    result.degraded_legs = parsed.degraded_legs
    result.confidence = parsed.confidence
    result.intent = parsed.intent
    return result


async def run_eval(
    entries: Sequence[GoldenEntry],
    endpoint: Endpoint,
    *,
    base_url: str,
    api_key: str,
    concurrency: int = 2,
    timeout_s: float = 180.0,
    transport: httpx.AsyncBaseTransport | None = None,
    on_result: Callable[[QuestionResult], None] | None = None,
) -> list[QuestionResult]:
    """Evaluate ``entries`` with at most ``concurrency`` requests in flight.

    Results come back in golden-set order regardless of completion order.
    """
    if concurrency < 1:
        raise ValueError("concurrency must be >= 1")
    semaphore = asyncio.Semaphore(concurrency)
    headers = {API_KEY_HEADER: api_key} if api_key else {}
    async with httpx.AsyncClient(
        base_url=base_url, headers=headers, timeout=timeout_s, transport=transport
    ) as client:

        async def bounded(entry: GoldenEntry) -> QuestionResult:
            async with semaphore:
                res = await evaluate_one(client, endpoint, entry)
            if on_result is not None:
                on_result(res)
            return res

        return list(await asyncio.gather(*(bounded(e) for e in entries)))


def file_sha256(path: Path) -> str:
    """SHA-256 of the file with line endings normalised to LF.

    A Windows checkout (CRLF) and the Linux prod host (LF) must agree on the
    golden-set hash, or every cross-machine comparison looks like a set change.
    """
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def build_report(
    results: Sequence[QuestionResult],
    *,
    endpoint: str,
    base_url: str,
    golden_path: Path,
    started_at: str,
    duration_s: float,
    ks: Sequence[int] = DEFAULT_KS,
) -> dict[str, object]:
    models = sorted({r.model_name for r in results if r.model_name})
    return {
        "meta": {
            "endpoint": endpoint,
            "base_url": base_url,
            "started_at": started_at,
            "duration_s": round(duration_s, 2),
            "golden_path": golden_path.name,
            "golden_sha256": file_sha256(golden_path),
            "n_questions": len(results),
            "model_names": models,
            "ks": list(ks),
        },
        "metrics": summarize(results, ks),
        "results": [r.to_json() for r in results],
    }


def _progress(res: QuestionResult) -> None:
    detail = res.error or res.abstain_reason or f"{len(res.sources)} sources"
    print(f"  {res.id:<10} {res.status:<9} {res.latency_ms:8.0f} ms  {detail}", file=sys.stderr)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m evals.run",
        description="Run the answer golden set against a live rag-service.",
    )
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument(
        "--api-key",
        default=os.environ.get(API_KEY_ENV, ""),
        help=f"sent as {API_KEY_HEADER}; defaults to ${API_KEY_ENV}",
    )
    parser.add_argument("--endpoint", choices=sorted(ENDPOINTS), default="answer")
    parser.add_argument("--out", type=Path, default=None, help="result JSON path")
    parser.add_argument("--golden", type=Path, default=GOLDEN_PATH)
    parser.add_argument("--limit", type=int, default=None, help="first N questions only")
    parser.add_argument("--ids", default=None, help="comma-separated golden ids to run")
    parser.add_argument("--concurrency", type=int, default=2)
    parser.add_argument("--timeout", type=float, default=180.0, help="per-request seconds")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    entries = load_golden(args.golden)
    if args.ids:
        wanted = {i.strip() for i in str(args.ids).split(",") if i.strip()}
        entries = [e for e in entries if e.id in wanted]
    if args.limit is not None:
        entries = entries[: args.limit]
    if not entries:
        print("no golden entries selected", file=sys.stderr)
        return 2

    started = datetime.now(UTC)
    stamp = started.strftime("%Y%m%dT%H%M%SZ")
    out: Path = args.out or RESULTS_DIR / f"{stamp}-{args.endpoint}.json"
    endpoint = ENDPOINTS[args.endpoint]
    print(f"{len(entries)} questions -> {args.base_url}{endpoint.path}", file=sys.stderr)

    t0 = time.perf_counter()
    results = asyncio.run(
        run_eval(
            entries,
            endpoint,
            base_url=args.base_url,
            api_key=args.api_key,
            concurrency=args.concurrency,
            timeout_s=args.timeout,
            on_result=_progress,
        )
    )
    report = build_report(
        results,
        endpoint=args.endpoint,
        base_url=args.base_url,
        golden_path=args.golden,
        started_at=started.isoformat(),
        duration_s=time.perf_counter() - t0,
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(summary_markdown(results))
    print(f"\nwrote {out}", file=sys.stderr)
    errors = sum(r.status == "error" for r in results)
    return 1 if errors == len(results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
