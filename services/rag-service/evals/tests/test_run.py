from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx
import pytest

from evals import run
from evals.model import ExpectedAuthority, GoldenEntry, load_results


def entry(id: str, question: str = "What is Art. 36?", must_abstain: bool = False) -> GoldenEntry:  # noqa: A002
    return GoldenEntry(
        id=id,
        question=question,
        subject="Civil Law",
        expected_authorities=()
        if must_abstain
        else (ExpectedAuthority("gr_no", "G.R. No. 196359"),),
        must_abstain=must_abstain,
        notes="",
        reviewed=False,
    )


ANSWER_BODY: dict[str, object] = {
    "answer": "Psychological incapacity ... [1]",
    "query": "What is Art. 36?",
    "intent": "legal_question",
    "confidence": 0.82,
    "confidence_level": "high",
    "citations": [
        {"source_id": "d1", "section_id": None, "text": "", "valid": True},
        {"source_id": "d9", "section_id": None, "text": "", "valid": False},
    ],
    "sources": [
        {
            "document_id": "d1",
            "section_id": "s1",
            "title": "Tan-Andal v. Andal",
            "citation_text": "G.R. No. 196359",
            "court": "Supreme Court",
            "decision_date": "2021-05-11",
            "document_type": "decision",
            "relevance_score": 0.016,
            "rerank_score": 0.97,
        },
        {
            "document_id": "d2",
            "title": "The Family Code of the Philippines",
            "citation_text": "Exec. Order No. 209 (1987)",
            "document_type": "codal",
            "rerank_score": None,
        },
    ],
    "abstained": False,
    "abstention_reason": None,
    "model_name": "qwen-test",
    "degraded_legs": ["knn:http_error"],
}

ABSTAIN_BODY: dict[str, object] = {
    "answer": "I cannot answer that.",
    "query": "q",
    "intent": "legal_question",
    "confidence": 0.0,
    "confidence_level": "low",
    "abstained": True,
    "abstention_reason": "low_relevance",
    "model_name": "",
}


def make_transport(seen: list[httpx.Request]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        body = json.loads(request.content)
        if "zebra" in body["query"]:
            return httpx.Response(200, json=ABSTAIN_BODY)
        if "boom" in body["query"]:
            return httpx.Response(503, json={"detail": "budget exceeded"})
        return httpx.Response(200, json=ANSWER_BODY)

    return httpx.MockTransport(handler)


def test_parse_answer_response_extracts_scored_fields() -> None:
    parsed = run.parse_answer_response(ANSWER_BODY)
    assert not parsed.abstained
    assert (parsed.citations_total, parsed.citations_valid) == (2, 1)
    assert parsed.model_name == "qwen-test"
    assert parsed.degraded_legs == ["knn:http_error"]
    assert parsed.intent == "legal_question"
    first, second = parsed.sources
    assert first.gr_no == "G.R. No. 196359" and first.rerank_score == 0.97
    assert second.gr_no is None and second.rerank_score is None
    assert second.document_type == "codal"


def test_parse_answer_response_tolerates_missing_fields() -> None:
    parsed = run.parse_answer_response({})
    assert parsed.sources == [] and parsed.citations_total == 0 and not parsed.abstained


def test_answer_payload_matches_answer_request_contract() -> None:
    payload = run.build_answer_payload(entry("x", "What is Art. 36?"))
    # Keys must all exist on src/answer/schemas.py::AnswerRequest (strict model).
    assert set(payload) <= {
        "query", "organization_id", "user_id", "max_passages",
        "include_sources", "document_id", "history",
    }
    assert payload["query"] == "What is Art. 36?"
    assert "organization_id" not in payload


def test_run_eval_sends_header_and_records_statuses() -> None:
    seen: list[httpx.Request] = []
    entries = [
        entry("ok"),
        entry("abs", "zebra question", must_abstain=True),
        entry("err", "boom"),
    ]
    results = asyncio.run(
        run.run_eval(
            entries,
            run.ENDPOINTS["answer"],
            base_url="http://rag-service:8000",
            api_key="sekret",
            concurrency=2,
            transport=make_transport(seen),
        )
    )
    assert [r.id for r in results] == ["ok", "abs", "err"]
    assert [r.status for r in results] == ["answered", "abstained", "error"]
    assert all(req.headers["X-Internal-Api-Key"] == "sekret" for req in seen)
    assert all(req.url.path == "/answer" and req.method == "POST" for req in seen)
    ok, abs_, err = results
    assert ok.citations_valid == 1 and ok.sources[0].gr_no == "G.R. No. 196359"
    assert abs_.abstain_reason == "low_relevance"
    assert err.http_status == 503 and err.error is not None and "503" in err.error


def test_run_eval_records_transport_errors() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    results = asyncio.run(
        run.run_eval(
            [entry("a")],
            run.ENDPOINTS["answer"],
            base_url="http://x",
            api_key="",
            transport=httpx.MockTransport(handler),
        )
    )
    assert results[0].status == "error"
    assert results[0].error is not None and "ConnectError" in results[0].error


def test_run_eval_rejects_bad_concurrency() -> None:
    with pytest.raises(ValueError):
        asyncio.run(
            run.run_eval([], run.ENDPOINTS["answer"], base_url="http://x", api_key="",
                         concurrency=0)
        )


def test_report_round_trips_through_load_results(tmp_path: Path) -> None:
    seen: list[httpx.Request] = []
    results = asyncio.run(
        run.run_eval(
            [entry("ok"), entry("abs", "zebra", must_abstain=True)],
            run.ENDPOINTS["answer"],
            base_url="http://x",
            api_key="k",
            transport=make_transport(seen),
        )
    )
    golden = tmp_path / "g.jsonl"
    golden.write_text("{}\n", encoding="utf-8")
    report = run.build_report(
        results,
        endpoint="answer",
        base_url="http://x",
        golden_path=golden,
        started_at="2026-01-01T00:00:00+00:00",
        duration_s=1.0,
    )
    out = tmp_path / "r.json"
    out.write_text(json.dumps(report), encoding="utf-8")
    meta, loaded = load_results(out)
    assert meta["endpoint"] == "answer" and meta["model_names"] == ["qwen-test"]
    assert [r.to_json() for r in loaded] == [r.to_json() for r in results]
    metrics = report["metrics"]
    assert isinstance(metrics, dict)
    assert metrics["authority_hit@1"] == 1.0
    assert metrics["abstention_recall"] == 1.0


def test_endpoint_choice_is_a_registry() -> None:
    args = run.parse_args(["--endpoint", "answer", "--limit", "3", "--concurrency", "4"])
    assert args.endpoint == "answer" and args.limit == 3 and args.concurrency == 4
    with pytest.raises(SystemExit):
        run.parse_args(["--endpoint", "nope"])


def test_api_key_defaults_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RAG_INTERNAL_API_KEY", "from-env")
    assert run.parse_args([]).api_key == "from-env"
