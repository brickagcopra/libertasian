"""Data model for the golden set and for run result files.

Plain dataclasses parsed by hand from JSON, so the harness depends on nothing
beyond the stdlib (and httpx for the client). Parsing is strict: a malformed
golden line fails loudly with its line number rather than silently scoring as
a miss.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

SUBJECTS: tuple[str, ...] = (
    "Political Law",
    "Labor Law",
    "Civil Law",
    "Taxation Law",
    "Mercantile Law",
    "Criminal Law",
    "Remedial Law",
    "Legal Ethics",
)

AUTHORITY_KINDS: tuple[str, ...] = ("gr_no", "statute", "title_contains")

Status = Literal["answered", "abstained", "error"]
STATUSES: tuple[str, ...] = ("answered", "abstained", "error")

GOLDEN_PATH = Path(__file__).resolve().parent / "golden" / "answers.jsonl"


class GoldenFormatError(ValueError):
    """A golden-set line does not match the expected shape."""


class ResultFormatError(ValueError):
    """A result file does not match the expected shape."""


@dataclass(frozen=True)
class ExpectedAuthority:
    """One acceptable controlling authority. ``kind`` is one of AUTHORITY_KINDS."""

    kind: str
    value: str

    def to_json(self) -> dict[str, str]:
        return {self.kind: self.value}


@dataclass(frozen=True)
class GoldenEntry:
    id: str
    question: str
    subject: str
    expected_authorities: tuple[ExpectedAuthority, ...]
    must_abstain: bool
    notes: str
    reviewed: bool


@dataclass
class SourceRecord:
    """One source as returned by the endpoint, reduced to what we score on."""

    title: str
    citation: str
    gr_no: str | None
    document_type: str
    rerank_score: float | None
    document_id: str = ""


@dataclass
class QuestionResult:
    id: str
    subject: str
    must_abstain: bool
    expected_authorities: list[dict[str, str]]
    status: Status
    abstain_reason: str | None = None
    error: str | None = None
    http_status: int | None = None
    sources: list[SourceRecord] = field(default_factory=list)
    citations_total: int = 0
    citations_valid: int = 0
    latency_ms: float = 0.0
    model_name: str = ""
    degraded_legs: list[str] = field(default_factory=list)
    confidence: float | None = None
    intent: str | None = None

    def to_json(self) -> dict[str, object]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Golden set
# ---------------------------------------------------------------------------


def _req_str(obj: dict[str, object], key: str, where: str) -> str:
    value = obj.get(key)
    if not isinstance(value, str) or not value.strip():
        raise GoldenFormatError(f"{where}: '{key}' must be a non-empty string")
    return value


def _req_bool(obj: dict[str, object], key: str, where: str) -> bool:
    value = obj.get(key)
    if not isinstance(value, bool):
        raise GoldenFormatError(f"{where}: '{key}' must be a boolean")
    return value


def parse_authority(raw: object, where: str) -> ExpectedAuthority:
    if not isinstance(raw, dict) or len(raw) != 1:
        raise GoldenFormatError(f"{where}: each authority must be a single-key object")
    ((kind, value),) = raw.items()
    if kind not in AUTHORITY_KINDS:
        raise GoldenFormatError(f"{where}: unknown authority kind {kind!r}")
    if not isinstance(value, str) or not value.strip():
        raise GoldenFormatError(f"{where}: authority value must be a non-empty string")
    return ExpectedAuthority(kind=str(kind), value=value)


def parse_golden_line(line: str, where: str) -> GoldenEntry:
    try:
        raw = json.loads(line)
    except json.JSONDecodeError as exc:
        raise GoldenFormatError(f"{where}: invalid JSON ({exc})") from exc
    if not isinstance(raw, dict):
        raise GoldenFormatError(f"{where}: line must be a JSON object")
    subject = _req_str(raw, "subject", where)
    if subject not in SUBJECTS:
        raise GoldenFormatError(f"{where}: subject {subject!r} not one of {SUBJECTS}")
    must_abstain = _req_bool(raw, "must_abstain", where)
    auths_raw = raw.get("expected_authorities")
    if not isinstance(auths_raw, list):
        raise GoldenFormatError(f"{where}: 'expected_authorities' must be a list")
    authorities = tuple(parse_authority(a, where) for a in auths_raw)
    if not must_abstain and not authorities:
        raise GoldenFormatError(f"{where}: answerable entries need >= 1 expected authority")
    if must_abstain and authorities:
        raise GoldenFormatError(f"{where}: must_abstain entries take no expected authority")
    notes = raw.get("notes", "")
    if not isinstance(notes, str):
        raise GoldenFormatError(f"{where}: 'notes' must be a string")
    return GoldenEntry(
        id=_req_str(raw, "id", where),
        question=_req_str(raw, "question", where),
        subject=subject,
        expected_authorities=authorities,
        must_abstain=must_abstain,
        notes=notes,
        reviewed=_req_bool(raw, "reviewed", where),
    )


def load_golden(path: Path = GOLDEN_PATH) -> list[GoldenEntry]:
    entries: list[GoldenEntry] = []
    seen: set[str] = set()
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        entry = parse_golden_line(line, f"{path.name}:{lineno}")
        if entry.id in seen:
            raise GoldenFormatError(f"{path.name}:{lineno}: duplicate id {entry.id!r}")
        seen.add(entry.id)
        entries.append(entry)
    return entries


# ---------------------------------------------------------------------------
# Result files
# ---------------------------------------------------------------------------


def _opt_str(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _num(value: object, default: float = 0.0) -> float:
    if isinstance(value, bool):
        return default
    if isinstance(value, int | float):
        return float(value)
    return default


def _int(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def parse_source(raw: object) -> SourceRecord:
    if not isinstance(raw, dict):
        raise ResultFormatError("source must be an object")
    rerank = raw.get("rerank_score")
    return SourceRecord(
        title=str(raw.get("title", "")),
        citation=str(raw.get("citation", "")),
        gr_no=_opt_str(raw.get("gr_no")),
        document_type=str(raw.get("document_type", "")),
        rerank_score=_num(rerank) if rerank is not None else None,
        document_id=str(raw.get("document_id", "")),
    )


def parse_question_result(raw: object) -> QuestionResult:
    if not isinstance(raw, dict):
        raise ResultFormatError("result entry must be an object")
    status = raw.get("status")
    if status not in STATUSES:
        raise ResultFormatError(f"result {raw.get('id')!r}: bad status {status!r}")
    auths = raw.get("expected_authorities", [])
    expected: list[dict[str, str]] = []
    if isinstance(auths, list):
        for a in auths:
            if isinstance(a, dict):
                expected.append({str(k): str(v) for k, v in a.items()})
    sources_raw = raw.get("sources", [])
    legs = raw.get("degraded_legs", [])
    confidence = raw.get("confidence")
    http_status = raw.get("http_status")
    return QuestionResult(
        id=str(raw.get("id", "")),
        subject=str(raw.get("subject", "")),
        must_abstain=raw.get("must_abstain") is True,
        expected_authorities=expected,
        status="answered" if status == "answered" else (
            "abstained" if status == "abstained" else "error"
        ),
        abstain_reason=_opt_str(raw.get("abstain_reason")),
        error=_opt_str(raw.get("error")),
        http_status=http_status if isinstance(http_status, int) else None,
        sources=[parse_source(s) for s in sources_raw] if isinstance(sources_raw, list) else [],
        citations_total=_int(raw.get("citations_total")),
        citations_valid=_int(raw.get("citations_valid")),
        latency_ms=_num(raw.get("latency_ms")),
        model_name=str(raw.get("model_name", "")),
        degraded_legs=[str(x) for x in legs] if isinstance(legs, list) else [],
        confidence=_num(confidence) if confidence is not None else None,
        intent=_opt_str(raw.get("intent")),
    )


def load_results(path: Path) -> tuple[dict[str, object], list[QuestionResult]]:
    """Return ``(meta, results)`` from a run file written by ``evals.run``."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ResultFormatError(f"{path}: top level must be an object")
    meta = raw.get("meta", {})
    results = raw.get("results")
    if not isinstance(results, list):
        raise ResultFormatError(f"{path}: 'results' must be a list")
    return (
        {str(k): v for k, v in meta.items()} if isinstance(meta, dict) else {},
        [parse_question_result(r) for r in results],
    )
