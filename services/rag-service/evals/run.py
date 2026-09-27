"""Run the golden set against a live rag-service and write a result file.

    python -m evals.run --base-url http://localhost:8000 \\
        --api-key "$RAG_INTERNAL_API_KEY" --endpoint answer|deep \\
        --out /tmp/rag-evals/<ts>.json [--limit N] [--concurrency 2]

Talks to the INTERNAL rag-service API (the one NestJS calls), authenticated
with the ``X-Internal-Api-Key`` header checked by ``src/shared/auth.py``.
Endpoints are pluggable via ``ENDPOINTS``. ``answer`` is a JSON POST;
``deep`` (POST /research/deep) is an SSE stream, consumed to its end and
reduced to the SAME `QuestionResult` shape, so ``python -m evals.compare``
diffs a deep run against an answer run like any two runs.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import sys
import time
from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from dataclasses import dataclass, replace
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
    # A pipeline failure the endpoint reported IN-BAND (an SSE ``error`` event
    # on a 200 stream). Scored exactly like an HTTP error: status "error".
    error: str | None = None


# One server-sent event: (event name, parsed JSON data).
SseEvent = tuple[str, object]


@dataclass(frozen=True)
class Endpoint:
    """How to call one rag-service route and read its response.

    ``parse_response`` receives the decoded JSON body for a plain endpoint,
    and the list of `SseEvent`s for a ``streaming`` one.
    """

    name: str
    path: str
    build_payload: Callable[[GoldenEntry], dict[str, object]]
    parse_response: Callable[[object], ParsedResponse]
    streaming: bool = False


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


# ---------------------------------------------------------------------------
# /research/deep  (src/deep_research: DeepResearchRequest, SSE event contract)
# ---------------------------------------------------------------------------


def build_deep_payload(entry: GoldenEntry) -> dict[str, object]:
    # Keys must exist on src/deep_research/schemas.py::DeepResearchRequest.
    return {"question": entry.question}


def _deep_citations(result: dict[str, object]) -> list[dict[str, object]]:
    return [
        _as_dict(c)
        for s in _as_list(result.get("sections"))
        for claim in _as_list(_as_dict(s).get("claims"))
        for c in _as_list(_as_dict(claim).get("citations"))
    ]


def _as_events(value: object) -> list[SseEvent]:
    events: list[SseEvent] = []
    for item in _as_list(value):
        if isinstance(item, tuple) and len(item) == 2 and isinstance(item[0], str):
            events.append((item[0], item[1]))
    return events


def parse_deep_response(body: object) -> ParsedResponse:
    """Reduce a deep-research event stream to the /answer result shape.

    - sources: the ``sources`` event, in S1..Sn (final rerank) order: the same
      ranked-passage list /answer returns as ``sources``, so authority_hit@k
      measures the same thing on both. ``rerank_score`` is None (the event
      carries no scores). ``gr_no`` is the backend's ``grNo``, else parsed from
      the citation/title exactly as for /answer.
    - answered/abstained: ``result.abstained`` / ``result.abstainReason``.
    - citations: every citation in the delivered ``result``; valid when its
      ``sourceId`` names a delivered source and it carries a quote. A citation
      the verifier removed is not delivered, as with /answer's validator.
    - model_name, degraded_legs: from ``done`` (``degradedLegs`` is an internal
      extra the gateway strips before clients see it).
    - an ``error`` event, or a stream with no ``result``, is an error.
    """
    by_name: dict[str, dict[str, object]] = {}
    for name, data in _as_events(body):
        by_name.setdefault(name, _as_dict(data))

    if "error" in by_name:
        err = by_name["error"]
        return ParsedResponse(
            abstained=False,
            abstain_reason=None,
            sources=[],
            citations_total=0,
            citations_valid=0,
            model_name="",
            degraded_legs=[],
            confidence=None,
            intent=None,
            error=f"{err.get('code')}: {err.get('message')}",
        )
    if "result" not in by_name:
        raise ValueError("stream ended without a result event")

    sources: list[SourceRecord] = []
    source_ids: set[str] = set()
    for raw in _as_list(by_name.get("sources", {}).get("sources")):
        s = _as_dict(raw)
        title = str(s.get("title") or "")
        citation = str(s.get("citation") or "")
        gr_no = s.get("grNo")
        source_ids.add(str(s.get("sourceId") or ""))
        sources.append(
            SourceRecord(
                title=title,
                citation=citation,
                gr_no=gr_no if isinstance(gr_no, str) and gr_no else first_gr_no(citation, title),
                document_type=str(s.get("documentType") or ""),
                rerank_score=None,
                document_id=str(s.get("documentId") or ""),
            )
        )

    result = by_name["result"]
    done = by_name.get("done", {})
    citations = _deep_citations(result)
    reason = result.get("abstainReason")
    return ParsedResponse(
        abstained=result.get("abstained") is True,
        abstain_reason=reason if isinstance(reason, str) else None,
        sources=sources,
        citations_total=len(citations),
        citations_valid=sum(
            str(c.get("sourceId") or "") in source_ids and bool(c.get("quote"))
            for c in citations
        ),
        model_name=str(done.get("modelName") or ""),
        degraded_legs=[str(x) for x in _as_list(done.get("degradedLegs"))],
        confidence=None,
        intent=None,
    )


def _decode_event(name: str, data_lines: list[str]) -> SseEvent:
    try:
        return (name, json.loads("\n".join(data_lines)))
    except json.JSONDecodeError as exc:
        raise ValueError(f"event {name!r} carries invalid JSON") from exc


async def read_sse(lines: AsyncIterator[str]) -> list[SseEvent]:
    """Parse an SSE body into ``(event, data)`` pairs. Data must be JSON."""
    events: list[SseEvent] = []
    name = "message"
    data_lines: list[str] = []
    async for line in lines:
        if line == "":
            if data_lines:
                events.append(_decode_event(name, data_lines))
            name, data_lines = "message", []
        elif line.startswith("event:"):
            name = line[len("event:") :].strip()
        elif line.startswith("data:"):
            data_lines.append(line[len("data:") :].lstrip())
    if data_lines:
        events.append(_decode_event(name, data_lines))
    return events


ENDPOINTS: Mapping[str, Endpoint] = {
    "answer": Endpoint(
        name="answer",
        path="/answer",
        build_payload=build_answer_payload,
        parse_response=parse_answer_response,
    ),
    "deep": Endpoint(
        name="deep",
        path="/research/deep",
        build_payload=build_deep_payload,
        parse_response=parse_deep_response,
        streaming=True,
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


async def _fetch(
    client: httpx.AsyncClient, endpoint: Endpoint, entry: GoldenEntry
) -> tuple[int, str, object]:
    """``(status, error_text, body)``: body is the JSON, or the SSE events.

    A streaming endpoint is read to the end of the stream, so latency covers
    the whole answer, not time-to-first-byte.
    """
    payload = endpoint.build_payload(entry)
    if not endpoint.streaming:
        response = await client.post(endpoint.path, json=payload)
        if response.status_code != 200:
            return response.status_code, response.text[:300], None
        return response.status_code, "", response.json()
    async with client.stream("POST", endpoint.path, json=payload) as response:
        if response.status_code != 200:
            text = (await response.aread()).decode("utf-8", errors="replace")
            return response.status_code, text[:300], None
        return response.status_code, "", await read_sse(response.aiter_lines())


async def evaluate_one(
    client: httpx.AsyncClient, endpoint: Endpoint, entry: GoldenEntry
) -> QuestionResult:
    result = _base_result(entry)
    started = time.perf_counter()
    try:
        status_code, error_text, body = await _fetch(client, endpoint, entry)
    except httpx.HTTPError as exc:
        result.latency_ms = (time.perf_counter() - started) * 1000
        result.error = f"{type(exc).__name__}: {exc}"
        return result
    except ValueError as exc:
        # A 200 whose body is not JSON (plain) or carries a malformed event.
        result.latency_ms = (time.perf_counter() - started) * 1000
        result.http_status = 200
        result.error = f"unparseable response: {exc}"
        return result
    result.latency_ms = (time.perf_counter() - started) * 1000
    result.http_status = status_code
    if status_code != 200:
        result.error = f"HTTP {status_code}: {error_text}"
        return result
    try:
        parsed = endpoint.parse_response(body)
    except ValueError as exc:
        result.error = f"unparseable response: {exc}"
        return result
    if parsed.error is not None:
        result.error = parsed.error
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
    parser.add_argument(
        "--model-override",
        default=None,
        help="deep only: writer model for every question (must be listed in "
        "the server's DEEP_RESEARCH_MODEL_ALLOWLIST)",
    )
    return parser.parse_args(argv)


def select_endpoint(name: str, model_override: str | None) -> Endpoint:
    """The endpoint to run, with ``--model-override`` folded into its payload."""
    endpoint = ENDPOINTS[name]
    if model_override is None:
        return endpoint
    if name != "deep":
        raise SystemExit("--model-override applies to --endpoint deep only")
    base = endpoint.build_payload

    def build(entry: GoldenEntry) -> dict[str, object]:
        return {**base(entry), "model_override": model_override}

    return replace(endpoint, build_payload=build)


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
    endpoint = select_endpoint(args.endpoint, args.model_override)
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
