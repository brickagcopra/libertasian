"""``--endpoint deep``: the SSE stream is reduced to the /answer result schema."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest

from evals import compare, run
from evals.model import GoldenEntry, QuestionResult, load_results
from evals.tests.test_run import entry, make_transport


def frame(event: str, data: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


SOURCES: list[dict[str, object]] = [
    {
        "sourceId": "S1",
        "documentId": "d1",
        "sectionId": "s1",
        "title": "Tan-Andal v. Andal",
        "citation": "G.R. No. 196359",
        "grNo": "G.R. No. 196359",
        "court": "Supreme Court",
        "date": "2021-05-11",
        "sectionLabel": "Ruling",
        "documentType": "decision",
    },
    {
        "sourceId": "S2",
        "documentId": "d2",
        "sectionId": None,
        "title": "The Family Code of the Philippines",
        "citation": "Exec. Order No. 209 (1987)",
        "grNo": None,
        "court": "",
        "date": "",
        "sectionLabel": None,
        "documentType": "codal",
    },
]

ANSWERED_STREAM = "".join(
    [
        frame("stage", {"stage": "planning"}),
        frame("plan", {"subQueries": ["Art. 36", "Tan-Andal"]}),
        frame("stage", {"stage": "searching", "detail": "3 queries"}),
        frame("stage", {"stage": "ranking"}),
        frame("sources", {"sources": SOURCES}),
        frame("stage", {"stage": "writing"}),
        frame("stage", {"stage": "verifying"}),
        frame(
            "result",
            {
                "summary": "s",
                "sections": [
                    {
                        "heading": "h",
                        "claims": [
                            {
                                "text": "c1",
                                "citations": [
                                    {"sourceId": "S1", "quote": "a legal concept"},
                                    {"sourceId": "S2", "quote": "shall likewise be void"},
                                ],
                            }
                        ],
                    }
                ],
                "removedClaims": 1,
                "abstained": False,
            },
        ),
        frame(
            "done",
            {
                "runId": "r",
                "modelName": "gpt-6-luna",
                "promptTemplateVersion": "deep-research-v1",
                "latencyMs": 1234,
                "costUsd": 0.001,
                "degradedLegs": ["knn:not_configured"],
                "removalReasons": {"bad_label": 1, "verifier_unsupported": 2},
            },
        ),
    ]
)

ABSTAINED_STREAM = "".join(
    [
        frame("stage", {"stage": "planning"}),
        frame("plan", {"subQueries": []}),
        frame("sources", {"sources": []}),
        frame(
            "result",
            {
                "summary": "I cannot answer.",
                "sections": [],
                "removedClaims": 0,
                "abstained": True,
                "abstainReason": "low_relevance",
            },
        ),
        frame("done", {"runId": "r", "modelName": "gpt-4o-mini"}),
    ]
)

ERROR_STREAM = frame("stage", {"stage": "planning"}) + frame(
    "error", {"code": "budget_exhausted", "message": "AI generation is unavailable."}
)


def deep_transport(seen: list[httpx.Request]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        body = json.loads(request.content)
        question = str(body["question"])
        headers = {"content-type": "text/event-stream"}
        if "zebra" in question:
            return httpx.Response(200, text=ABSTAINED_STREAM, headers=headers)
        if "broke" in question:
            return httpx.Response(200, text=ERROR_STREAM, headers=headers)
        if "cut" in question:
            return httpx.Response(200, text=frame("stage", {"stage": "planning"}),
                                  headers=headers)
        if "garbled" in question:
            return httpx.Response(200, text="event: result\ndata: {not json\n\n",
                                  headers=headers)
        if "boom" in question:
            return httpx.Response(422, json={"detail": "model_override is not allowed"})
        return httpx.Response(200, text=ANSWERED_STREAM, headers=headers)

    return httpx.MockTransport(handler)


def _run(entries: list[GoldenEntry], endpoint: run.Endpoint,
         transport: httpx.MockTransport) -> list[QuestionResult]:
    return asyncio.run(
        run.run_eval(entries, endpoint, base_url="http://rag:8000", api_key="k",
                     transport=transport)
    )


async def _lines(text: str) -> AsyncIterator[str]:
    for line in text.split("\n"):
        yield line


def test_read_sse_parses_named_events_and_multiline_data() -> None:
    body = 'event: a\ndata: {"x":\ndata: 1}\n\n: comment\ndata: [2]\n\nevent: b\ndata: {}'
    events = asyncio.run(run.read_sse(_lines(body)))
    assert events == [("a", {"x": 1}), ("message", [2]), ("b", {})]


def test_read_sse_rejects_invalid_json() -> None:
    with pytest.raises(ValueError, match="invalid JSON"):
        asyncio.run(run.read_sse(_lines("event: result\ndata: {nope\n\n")))


def test_deep_payload_matches_request_contract() -> None:
    payload = run.build_deep_payload(entry("x", "What is Art. 36?"))
    # Keys must exist on src/deep_research/schemas.py::DeepResearchRequest.
    assert set(payload) <= {"question", "run_id", "model_override", "scope"}
    assert payload == {"question": "What is Art. 36?"}


def test_model_override_folds_into_the_deep_payload_only() -> None:
    endpoint = run.select_endpoint("deep", "gpt-6-luna")
    assert endpoint.build_payload(entry("x")) == {
        "question": "What is Art. 36?", "model_override": "gpt-6-luna",
    }
    assert run.select_endpoint("deep", None) is run.ENDPOINTS["deep"]
    with pytest.raises(SystemExit):
        run.select_endpoint("answer", "gpt-6-luna")


def test_run_eval_deep_maps_stream_to_the_answer_schema() -> None:
    seen: list[httpx.Request] = []
    entries = [
        entry("ok"),
        entry("abs", "zebra", must_abstain=True),
        entry("err", "broke"),
        entry("cut", "cut"),
        entry("bad", "garbled"),
        entry("http", "boom"),
    ]
    results = _run(entries, run.ENDPOINTS["deep"], deep_transport(seen))
    assert all(r.url.path == "/research/deep" and r.method == "POST" for r in seen)
    assert all(r.headers["X-Internal-Api-Key"] == "k" for r in seen)
    ok, abs_, err, cut, bad, http = results

    assert ok.status == "answered"
    assert [s.document_id for s in ok.sources] == ["d1", "d2"]
    assert ok.sources[0].gr_no == "G.R. No. 196359"
    assert ok.sources[1].gr_no is None and ok.sources[1].document_type == "codal"
    assert all(s.rerank_score is None for s in ok.sources)
    assert (ok.citations_total, ok.citations_valid) == (2, 2)
    assert ok.model_name == "gpt-6-luna"
    assert ok.degraded_legs == ["knn:not_configured"]
    assert ok.removal_reasons == {"bad_label": 1, "verifier_unsupported": 2}
    assert ok.http_status == 200 and ok.latency_ms > 0

    assert abs_.status == "abstained" and abs_.abstain_reason == "low_relevance"
    assert abs_.sources == [] and abs_.citations_total == 0
    assert abs_.removal_reasons is None  # done carried no removalReasons

    assert err.status == "error" and err.error is not None
    assert err.error.startswith("budget_exhausted")
    assert cut.status == "error" and "without a result" in (cut.error or "")
    assert bad.status == "error" and "invalid JSON" in (bad.error or "")
    assert http.status == "error" and http.http_status == 422


def test_citation_to_undelivered_source_is_invalid() -> None:
    events: list[run.SseEvent] = [
        ("sources", {"sources": SOURCES[:1]}),
        ("result", {"abstained": False, "sections": [{"claims": [{"citations": [
            {"sourceId": "S1", "quote": "q"},
            {"sourceId": "S7", "quote": "q"},
            {"sourceId": "S1", "quote": ""},
        ]}]}]}),
        ("done", {}),
    ]
    parsed = run.parse_deep_response(events)
    assert (parsed.citations_total, parsed.citations_valid) == (3, 1)


def test_deep_and_answer_results_compare(tmp_path: Path,
                                         capsys: pytest.CaptureFixture[str]) -> None:
    """The acceptance workflow: an answer run and a deep run feed evals.compare."""
    golden = tmp_path / "g.jsonl"
    golden.write_text("{}\n", encoding="utf-8")
    entries = [entry("ok"), entry("abs", "zebra", must_abstain=True)]

    paths: list[Path] = []
    for name, transport in (
        ("answer", make_transport([])),
        ("deep", deep_transport([])),
    ):
        results = _run(entries, run.ENDPOINTS[name], transport)
        report = run.build_report(
            results, endpoint=name, base_url="http://x", golden_path=golden,
            started_at="2026-01-01T00:00:00+00:00", duration_s=1.0,
        )
        path = tmp_path / f"{name}.json"
        path.write_text(json.dumps(report), encoding="utf-8")
        paths.append(path)
        meta, loaded = load_results(path)
        assert meta["endpoint"] == name
        assert [r.to_json() for r in loaded] == [r.to_json() for r in results]
        metrics = report["metrics"]
        assert isinstance(metrics, dict)
        assert metrics["authority_hit@1"] == 1.0
        assert metrics["abstention_recall"] == 1.0

    assert compare.main([str(paths[0]), str(paths[1])]) == 0
    out = capsys.readouterr().out
    assert "answer.json" in out and "deep.json" in out
