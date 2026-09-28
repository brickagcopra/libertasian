"""Deep Research: a multi-query, verified legal research answer.

Pipeline (each stage is announced on the SSE stream as a ``stage`` event):

1. **planning**  — a small model labels the question's scope (in_scope /
   non_ph_law / future_or_hypothetical / nonsense) and splits it into 3-5
   sub-queries. Anything but in_scope abstains (OUT_OF_SCOPE) before any
   retrieval: on the prod gate 2026-09-28 a US case, the German BGB and "PH
   tax rates for 2040" were all answered from loosely related PH passages.
2. **searching** — every sub-query (and the question itself) goes through the
   shared `retrieve_ranked` path WITHOUT the cross-encoder (``rerank=False``,
   fused RRF candidates), at most 3 in flight. Alongside, any
   provision named precisely ("Article 1318 of the Civil Code", "Rule 113
   Section 5") is read from PostgreSQL (`pinpoint.py`).
3. **ranking**   — the per-query results are merged and deduped by section,
   capped at 30 candidates and per document (2 for a decision, 6 for a
   statute), the pinpointed sections are put in front, then reranked ONCE
   against the original question — the only rerank call a question makes,
   with its own budget (`deep_research_rerank_timeout`). Abstention reads the
   RAW top rerank score, exactly as /answer does after #504. If the
   cross-encoder did not run there is no such score, and the run abstains
   (RANKING_UNAVAILABLE) instead of trusting RRF order.
4. **writing**   — the writer returns structured JSON whose citations are
   ``{source_id: "S3", quote}`` pairs. It never emits document metadata.
5. **verifying** — (a) the label must be one of S1..Sn, (b) the quote must be
   a whitespace-normalised substring of that passage, (c) one batched verifier
   call judges each surviving claim. A claim with no surviving citation, or
   judged unsupported, is removed and counted.

Every LLM call goes through `core.generation.generate_completion_with_usage`,
so the budget checks, the provider-quota breaker and the retry policy from
#506 all apply. A `BudgetExceededError` (which `ProviderQuotaExhaustedError`
subclasses) ends the stream with ``error {code: "budget_exhausted"}``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from collections import Counter
from collections.abc import AsyncIterator, Sequence
from typing import Any

from pydantic import ValidationError

from ..config import settings
from ..core.abstention import check_abstention, generate_abstention_response
from ..core.context import estimate_tokens
from ..core.generation import compute_cost_usd, generate_completion_with_usage
from ..core.ranked import RankedPassages, retrieve_ranked
from ..core.reranking import rerank_passages
from ..core.retrieval import STATUTORY_DOCUMENT_TYPES
from ..core.schemas import Passage
from ..core.types import AbstentionReason
from ..shared.database import acquire_connection
from ..shared.exceptions import BudgetExceededError, RetrievalError, SchemaIntegrityError
from .pinpoint import fetch_pinpoint_passages
from .prompts import (
    MAX_QUOTE_WORDS,
    MAX_SUB_QUERIES,
    PLANNER_RESPONSE_FORMAT,
    PLANNER_SYSTEM_PROMPT,
    PLANNER_USER_TEMPLATE,
    PROMPT_TEMPLATE_VERSION,
    VERIFIER_RESPONSE_FORMAT,
    VERIFIER_SYSTEM_PROMPT,
    VERIFIER_USER_TEMPLATE,
    WRITER_RESPONSE_FORMAT,
    WRITER_SYSTEM_PROMPT,
    WRITER_USER_TEMPLATE,
)
from .schemas import (
    Citation,
    Claim,
    DeepResearchRequest,
    Draft,
    LabelledPassage,
    LlmUsage,
    Plan,
    PlannerOutput,
    Section,
)

logger = logging.getLogger(__name__)

BUDGET_SCOPE = "ai_research"

# An SSE event as the service produces it: (event name, JSON-serialisable data).
Event = tuple[str, dict[str, Any]]

_SUB_QUERY_MAX_CHARS = 300
_PLANNER_MAX_TOKENS = 400
_VERIFIER_MAX_TOKENS = 1500
# A one-word "quote" is a substring of almost any passage and proves nothing.
_MIN_QUOTE_WORDS = 2
_LABEL_RE = re.compile(r"^S(\d{1,3})$")
_WS_RE = re.compile(r"\s+")
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)
_GR_RE = re.compile(
    r"G\.?\s*R\.?\s*(?:Nos?\.?)?\s*(L-)?\s*(\d[\d-]*\d|\d)", re.IGNORECASE
)
# Why verification dropped something. See `verify_draft` for the two units.
REMOVAL_BAD_LABEL = "bad_label"
REMOVAL_QUOTE_NOT_FOUND = "quote_not_found"
REMOVAL_QUOTE_LENGTH = "quote_length"
REMOVAL_NO_CITATIONS_LEFT = "no_citations_left"
REMOVAL_VERIFIER_UNSUPPORTED = "verifier_unsupported"
REMOVAL_VERIFIER_NO_VERDICT = "verifier_no_verdict"
REMOVAL_REASONS = (
    REMOVAL_BAD_LABEL,
    REMOVAL_QUOTE_NOT_FOUND,
    REMOVAL_QUOTE_LENGTH,
    REMOVAL_NO_CITATIONS_LEFT,
    REMOVAL_VERIFIER_UNSUPPORTED,
    REMOVAL_VERIFIER_NO_VERDICT,
)
_BUDGET_MESSAGE = "AI generation is temporarily unavailable. Please try again later."
_INTERNAL_MESSAGE = "Deep research failed. Please try again."


class ModelNotAllowedError(ValueError):
    """A ``model_override`` that is not in DEEP_RESEARCH_MODEL_ALLOWLIST."""


# ---------------------------------------------------------------------------
# Small pure helpers
# ---------------------------------------------------------------------------


def model_allowlist() -> set[str]:
    return {m.strip() for m in settings.deep_research_model_allowlist.split(",") if m.strip()}


def resolve_writer_model(override: str | None) -> str:
    """The writer model for a run. Raises ModelNotAllowedError for a bad override."""
    if not override:
        return settings.deep_research_model
    if override not in model_allowlist():
        raise ModelNotAllowedError(override)
    return override


def normalize_ws(text: str) -> str:
    return _WS_RE.sub(" ", text).strip()


def extract_gr_no(*texts: str) -> str | None:
    """Canonical ``G.R. No. XXXXXX`` from the first text that carries one."""
    for text in texts:
        match = _GR_RE.search(text or "")
        if match:
            return f"G.R. No. {match.group(1) or ''}{match.group(2)}"
    return None


def _raw_score(passage: Passage) -> float:
    return passage.rerank_score if passage.rerank_score is not None else passage.score


def _section_key(passage: Passage) -> str:
    # A document-level row (no section) is one unit of content however many
    # legs or sub-queries returned it.
    return f"{passage.document_id}:{passage.section_id or '<document>'}"


def merge_candidates(
    result_sets: Sequence[Sequence[Passage]],
    *,
    max_candidates: int,
    max_per_document: int,
    max_per_statute: int | None = None,
) -> list[Passage]:
    """Merge per-sub-query results: dedupe by section, cap per document and overall.

    A section returned by several sub-queries keeps its best raw score. The
    pool is ordered by that score before the caps are applied, so the caps
    drop the weakest candidates, and the per-document cap keeps one long
    decision from filling the whole pool.

    The cap depends on the document's type. ``max_per_document`` applies to
    decisions (and anything not statutory); ``max_per_statute`` to statutory
    types, where one "document" is a whole code — the Civil Code has 2,533
    sections — and a cap of 2 would allow a question at most two articles of
    it. ``None`` means the same cap for both.
    """
    statute_cap = max_per_document if max_per_statute is None else max_per_statute
    best: dict[str, Passage] = {}
    for passages in result_sets:
        for passage in passages:
            key = _section_key(passage)
            current = best.get(key)
            if current is None or _raw_score(passage) > _raw_score(current):
                best[key] = passage

    ordered = sorted(best.values(), key=_raw_score, reverse=True)
    per_document: Counter[str] = Counter()
    merged: list[Passage] = []
    for passage in ordered:
        cap = (
            statute_cap
            if passage.document_type in STATUTORY_DOCUMENT_TYPES
            else max_per_document
        )
        if per_document[passage.document_id] >= cap:
            continue
        per_document[passage.document_id] += 1
        merged.append(passage)
        if len(merged) >= max_candidates:
            break
    return merged


def add_pinpoints(
    pool: Sequence[Passage], pinpoints: Sequence[Passage], *, max_candidates: int
) -> list[Passage]:
    """Put the pinpointed sections at the front of the pool, deduped by section.

    They were named by the question, so they are not subject to the score-
    ordered caps; the rerank still decides whether they are kept. The pool
    stays within ``max_candidates``: pinpoints displace its weakest tail.
    """
    present = {_section_key(p) for p in pool}
    pinned: list[Passage] = []
    for passage in pinpoints:
        key = _section_key(passage)
        if key in present:
            continue
        present.add(key)
        pinned.append(passage)
    return [*pinned, *pool][:max_candidates]


def _clean_sub_queries(raw: object, question: str) -> list[str]:
    items = raw if isinstance(raw, list) else []
    seen = {normalize_ws(question).lower()}
    cleaned: list[str] = []
    for item in items:
        if not isinstance(item, str):
            continue
        text = normalize_ws(item)[:_SUB_QUERY_MAX_CHARS]
        if not text or text.lower() in seen:
            continue
        seen.add(text.lower())
        cleaned.append(text)
        if len(cleaned) >= MAX_SUB_QUERIES:
            break
    return cleaned


def _load_json_object(content: str) -> dict[str, Any]:
    """Parse a model's JSON response; tolerate a fenced block. {} if unusable."""
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def parse_draft(content: str) -> Draft | None:
    """The writer's JSON as a Draft, or None when it is not the expected shape."""
    data = _load_json_object(content)
    sections_raw = data.get("sections")
    if not isinstance(sections_raw, list):
        return None
    sections: list[Section] = []
    for section_raw in sections_raw:
        if not isinstance(section_raw, dict):
            continue
        claims: list[Claim] = []
        for claim_raw in section_raw.get("claims") or []:
            if not isinstance(claim_raw, dict):
                continue
            text = claim_raw.get("text")
            if not isinstance(text, str) or not text.strip():
                continue
            citations = [
                Citation(source_id=str(c.get("source_id", "")), quote=str(c.get("quote", "")))
                for c in claim_raw.get("citations") or []
                if isinstance(c, dict)
            ]
            claims.append(Claim(text=text.strip(), citations=citations))
        heading = section_raw.get("heading")
        sections.append(
            Section(heading=heading.strip() if isinstance(heading, str) else "", claims=claims)
        )
    summary = data.get("summary")
    return Draft(summary=summary.strip() if isinstance(summary, str) else "", sections=sections)


def filter_citations(
    draft: Draft, labelled: Sequence[LabelledPassage]
) -> tuple[Draft, Counter[str]]:
    """Verification steps (a) and (b), deterministic and in that order.

    (a) ``source_id`` must name one of the labels actually shown to the writer.
    (b) ``quote`` must be a whitespace-normalised substring of THAT passage,
        between 2 and ``MAX_QUOTE_WORDS`` words.
    Citations failing either are dropped. Claims are kept here even when they
    lose every citation; `verify_draft` removes and counts them.

    Returns the filtered draft and the dropped CITATIONS per reason:
    ``bad_label`` (a), ``quote_length`` and ``quote_not_found`` (b). A duplicate
    of a citation already kept is collapsed, not counted.
    """
    by_label = {lp.label: normalize_ws(lp.passage.text) for lp in labelled}
    dropped: Counter[str] = Counter()
    sections: list[Section] = []
    for section in draft.sections:
        claims: list[Claim] = []
        for claim in section.claims:
            kept: list[Citation] = []
            for citation in claim.citations:
                label = citation.source_id.strip().upper()
                if not _LABEL_RE.match(label) or label not in by_label:
                    dropped[REMOVAL_BAD_LABEL] += 1  # (a) fabricated or out of range
                    continue
                quote = normalize_ws(citation.quote)
                words = len(quote.split())
                if words < _MIN_QUOTE_WORDS or words > MAX_QUOTE_WORDS:
                    dropped[REMOVAL_QUOTE_LENGTH] += 1
                    continue
                if quote not in by_label[label]:
                    dropped[REMOVAL_QUOTE_NOT_FOUND] += 1  # (b) not verbatim
                    continue
                if any(k.source_id == label and k.quote == quote for k in kept):
                    continue
                kept.append(Citation(source_id=label, quote=quote))
            claims.append(Claim(text=claim.text, citations=kept))
        sections.append(Section(heading=section.heading, claims=claims))
    return Draft(summary=draft.summary, sections=sections), dropped


# ---------------------------------------------------------------------------
# LLM stages
# ---------------------------------------------------------------------------


async def _call_llm(
    *,
    system_prompt: str,
    user_prompt: str,
    model: str,
    max_tokens: int,
    temperature: float,
    response_format: dict[str, Any],
    usage: LlmUsage,
) -> dict[str, Any]:
    result = await generate_completion_with_usage(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_tokens=max_tokens,
        temperature=temperature,
        response_format=response_format,
        scope=BUDGET_SCOPE,
        model=model,
    )
    tokens_in = int(result.get("tokens_in") or 0)
    tokens_out = int(result.get("tokens_out") or 0)
    usage.tokens_in += tokens_in
    usage.tokens_out += tokens_out
    ran_model = str(result.get("model_name") or model)
    usage.cost_usd += compute_cost_usd(ran_model, tokens_in, tokens_out)
    return result


async def plan_research(question: str, usage: LlmUsage) -> Plan:
    """Scope label and sub-queries for ``question``, from the planner model.

    A response that fails `PlannerOutput` validation counts as in_scope with no
    sub-queries: the question itself is still searched and every downstream
    abstention still applies. Failing closed here would refuse legitimate
    questions whenever the planner returned malformed JSON.
    """
    result = await _call_llm(
        system_prompt=PLANNER_SYSTEM_PROMPT,
        user_prompt=PLANNER_USER_TEMPLATE.format(question=question),
        model=settings.deep_research_planner_model,
        max_tokens=_PLANNER_MAX_TOKENS,
        temperature=0.2,
        response_format=PLANNER_RESPONSE_FORMAT,
        usage=usage,
    )
    try:
        output = PlannerOutput.model_validate(_load_json_object(str(result.get("content") or "")))
    except ValidationError:
        logger.warning("Deep research planner returned an invalid plan; searching the question")
        return Plan(scope="in_scope")
    if output.scope != "in_scope":
        return Plan(scope=output.scope)
    return Plan(scope=output.scope, sub_queries=_clean_sub_queries(output.sub_queries, question))


def _rerank_degraded(degraded_legs: Sequence[str]) -> bool:
    """True when the cross-encoder did not score the pool (any reranker marker)."""
    return any(leg.startswith("reranker:") for leg in degraded_legs)


async def verify_draft(
    draft: Draft, labelled: Sequence[LabelledPassage], usage: LlmUsage
) -> tuple[Draft, int, dict[str, int]]:
    """Run verification (a), (b), (c).

    Returns the verified draft, the number of claims removed, and why, as
    ``{reason: count}`` over all of `REMOVAL_REASONS`. Two units share the
    map: ``bad_label`` / ``quote_length`` / ``quote_not_found`` count dropped
    CITATIONS (a claim with three bad citations adds three), while
    ``no_citations_left`` / ``verifier_unsupported`` / ``verifier_no_verdict``
    count removed CLAIMS and sum to the removed number.

    Fails closed: a claim the verifier gives no verdict for is removed, the
    same as one it marks unsupported. A summary judged unsupported is replaced
    by the surviving claims themselves.
    """
    total = draft.claim_count()
    filtered, reasons = filter_citations(draft, labelled)

    candidates: list[tuple[str, Claim]] = []
    for section in filtered.sections:
        for claim in section.claims:
            if claim.citations:
                candidates.append((f"C{len(candidates) + 1}", claim))

    supported_ids: set[str] = set()
    unsupported_ids: set[str] = set()
    summary_supported = False
    if candidates:
        claims_block = "\n\n".join(
            f"[{cid}] {claim.text}\n"
            + "\n".join(f'  EVIDENCE ({c.source_id}): "{c.quote}"' for c in claim.citations)
            for cid, claim in candidates
        )
        result = await _call_llm(
            system_prompt=VERIFIER_SYSTEM_PROMPT,
            user_prompt=VERIFIER_USER_TEMPLATE.format(
                claims=claims_block, summary=filtered.summary or "(none)"
            ),
            model=settings.deep_research_verifier_model,
            max_tokens=_VERIFIER_MAX_TOKENS,
            temperature=0.0,
            response_format=VERIFIER_RESPONSE_FORMAT,
            usage=usage,
        )
        verdict_data = _load_json_object(str(result.get("content") or ""))
        for verdict in verdict_data.get("verdicts") or []:
            if not isinstance(verdict, dict):
                continue
            claim_id = str(verdict.get("claim_id", "")).strip().upper()
            if verdict.get("supported") is True:
                supported_ids.add(claim_id)
            elif verdict.get("supported") is False:
                unsupported_ids.add(claim_id)
        summary_supported = verdict_data.get("summary_supported") is True

    keep = {id(claim) for cid, claim in candidates if cid in supported_ids}
    for section in filtered.sections:
        reasons[REMOVAL_NO_CITATIONS_LEFT] += sum(1 for c in section.claims if not c.citations)
    for cid, _claim in candidates:
        if cid in supported_ids:
            continue
        # Counting only: an explicit "supported": false is unsupported; a
        # missing or malformed verdict is no verdict. Both are removed alike.
        if cid in unsupported_ids:
            reasons[REMOVAL_VERIFIER_UNSUPPORTED] += 1
        else:
            reasons[REMOVAL_VERIFIER_NO_VERDICT] += 1
    sections: list[Section] = []
    kept_count = 0
    for section in filtered.sections:
        claims = [c for c in section.claims if id(c) in keep]
        if claims:
            kept_count += len(claims)
            sections.append(Section(heading=section.heading, claims=claims))

    summary = filtered.summary
    if not summary_supported or not summary:
        summary = " ".join(c.text for s in sections for c in s.claims[:1])[:1200]
    counts = {reason: reasons[reason] for reason in REMOVAL_REASONS}
    return Draft(summary=summary, sections=sections), total - kept_count, counts


# ---------------------------------------------------------------------------
# Retrieval and context
# ---------------------------------------------------------------------------


async def retrieve_all(queries: Sequence[str]) -> tuple[list[RankedPassages], list[str]]:
    """`retrieve_ranked` for every query, at most N in flight, NOT reranked.

    Sub-queries return fused RRF candidates; the merged pool gets the one
    rerank in `run_deep_research`. Reranking each sub-query is what took the
    reranker down on prod 2026-09-28: it scores one request at a time (~12s per
    30-40 passages on CPU), so 3 in flight meant the 2nd and 3rd timed out
    here while the reranker kept scoring them, its queue reached 540s, and
    every /answer in that window fell back to RRF.

    A failing sub-query degrades the run rather than failing it; only when
    every one fails is there nothing to research from.
    """
    semaphore = asyncio.Semaphore(max(1, settings.deep_research_concurrency))

    async def one(query: str) -> RankedPassages:
        async with semaphore:
            return await retrieve_ranked(
                query, top_k=settings.deep_research_subquery_top_k, rerank=False
            )

    outcomes = await asyncio.gather(*(one(q) for q in queries), return_exceptions=True)
    ranked: list[RankedPassages] = []
    degraded: list[str] = []
    for outcome in outcomes:
        if isinstance(outcome, BaseException):
            logger.warning("Deep research sub-query retrieval failed: %s", type(outcome).__name__)
            degraded.append("subquery:failed")
            continue
        ranked.append(outcome)
        degraded.extend(outcome.degraded_legs)
    if not ranked:
        raise RetrievalError("every deep research sub-query failed")
    return ranked, list(dict.fromkeys(degraded))


async def lookup_section_metadata(
    passages: Sequence[Passage],
) -> dict[str, tuple[str | None, str | None]]:
    """``{passage.id: (gr_no, section_label)}`` from PostgreSQL, best effort.

    The index carries neither the section label nor, reliably, the G.R.
    number, and the sources the user sees must name the exact section cited.
    A lookup failure degrades to regex-derived G.R. numbers and no label.
    """
    section_ids = sorted(
        {p.section_id for p in passages if p.section_id and _UUID_RE.match(p.section_id)}
    )
    document_ids = sorted({p.document_id for p in passages if _UUID_RE.match(p.document_id)})
    if not section_ids and not document_ids:
        return {}
    try:
        async with acquire_connection() as conn:
            section_rows = (
                await conn.fetch(
                    "SELECT s.id::text AS id, s.section_label, s.section_type "
                    "FROM legal_document_sections s WHERE s.id = ANY($1::uuid[])",
                    section_ids,
                )
                if section_ids
                else []
            )
            document_rows = (
                await conn.fetch(
                    "SELECT d.id::text AS id, d.gr_no FROM legal_documents d "
                    "WHERE d.id = ANY($1::uuid[])",
                    document_ids,
                )
                if document_ids
                else []
            )
    except SchemaIntegrityError:
        logger.exception("SchemaIntegrityError in deep research section lookup")
        raise
    except Exception as exc:  # noqa: BLE001 - enrichment is best effort
        logger.warning("Deep research section lookup failed: %s", type(exc).__name__)
        return {}

    labels: dict[str, str | None] = {}
    for row in section_rows:
        label = row["section_label"] or row["section_type"]
        labels[str(row["id"])] = str(label) if label else None
    gr_nos = {
        str(row["id"]): (str(row["gr_no"]) if row["gr_no"] else None) for row in document_rows
    }
    return {
        p.id: (
            gr_nos.get(p.document_id),
            labels.get(p.section_id) if p.section_id else None,
        )
        for p in passages
    }


def label_passages(
    passages: Sequence[Passage],
    metadata: dict[str, tuple[str | None, str | None]],
    token_budget: int,
) -> tuple[list[LabelledPassage], str]:
    """Assign S1..Sn in rank order until the context budget is spent."""
    labelled: list[LabelledPassage] = []
    blocks: list[str] = []
    used = 0
    for passage in passages:
        db_gr_no, section_label = metadata.get(passage.id, (None, None))
        label = f"S{len(labelled) + 1}"
        header_parts = [
            passage.title,
            passage.citation_text,
            passage.court,
            passage.decision_date,
            section_label or "",
        ]
        header = " | ".join(part for part in header_parts if part)
        block = f"[{label}] {header}\n{passage.text}"
        cost = estimate_tokens(block) + (10 if blocks else 0)
        if used + cost > token_budget:
            break
        used += cost
        blocks.append(block)
        labelled.append(
            LabelledPassage(
                label=label,
                passage=passage,
                gr_no=db_gr_no or extract_gr_no(passage.citation_text, passage.title),
                section_label=section_label,
            )
        )
    return labelled, "\n\n---\n\n".join(blocks)


# ---------------------------------------------------------------------------
# Event payloads
# ---------------------------------------------------------------------------


def _stage(stage: str, detail: str | None = None) -> Event:
    data: dict[str, Any] = {"stage": stage}
    if detail:
        data["detail"] = detail
    return ("stage", data)


def sources_payload(labelled: Sequence[LabelledPassage]) -> dict[str, Any]:
    return {
        "sources": [
            {
                "sourceId": lp.label,
                "documentId": lp.passage.document_id,
                "sectionId": lp.passage.section_id,
                "title": lp.passage.title,
                "citation": lp.passage.citation_text,
                "grNo": lp.gr_no,
                "court": lp.passage.court,
                "date": lp.passage.decision_date,
                "sectionLabel": lp.section_label,
                "documentType": lp.passage.document_type,
            }
            for lp in labelled
        ]
    }


def result_payload(
    draft: Draft,
    removed: int,
    *,
    abstain_reason: AbstentionReason | None = None,
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "summary": draft.summary,
        "sections": [
            {
                "heading": section.heading,
                "claims": [
                    {
                        "text": claim.text,
                        "citations": [
                            {"sourceId": c.source_id, "quote": c.quote} for c in claim.citations
                        ],
                    }
                    for claim in section.claims
                ],
            }
            for section in draft.sections
        ],
        "removedClaims": removed,
        "abstained": abstain_reason is not None,
    }
    if abstain_reason is not None:
        data["abstainReason"] = abstain_reason.value
    return data


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


async def run_deep_research(request: DeepResearchRequest) -> AsyncIterator[Event]:
    """Run the pipeline, yielding ``(event, data)`` pairs per the SSE contract.

    Terminal events: ``result`` followed by ``done``, or a single ``error``.
    ``done`` carries three fields beyond the client contract — ``tokensIn``,
    ``tokensOut``, ``modelVersion`` — plus ``degradedLegs`` and
    ``removalReasons`` (read by the eval harness); the gateway forwards only
    the contract fields.
    """
    started = time.perf_counter()
    question = normalize_ws(request.question)
    run_id = request.run_id or str(uuid.uuid4())
    usage = LlmUsage()
    writer_model = resolve_writer_model(request.model_override)
    model_version: str | None = None
    degraded: list[str] = []
    # Verification's removal counts (see `verify_draft`); empty when the run
    # never reached verification.
    removal_reasons: dict[str, int] = {}

    def done() -> Event:
        return (
            "done",
            {
                "runId": run_id,
                "modelName": writer_model,
                "promptTemplateVersion": PROMPT_TEMPLATE_VERSION,
                "latencyMs": int((time.perf_counter() - started) * 1000),
                "costUsd": round(usage.cost_usd, 6),
                "tokensIn": usage.tokens_in,
                "tokensOut": usage.tokens_out,
                "modelVersion": model_version,
                "degradedLegs": degraded,
                "removalReasons": removal_reasons,
            },
        )

    def abstain(reason: AbstentionReason, removed: int = 0) -> Event:
        text = generate_abstention_response(reason, question)
        return ("result", result_payload(Draft(summary=text), removed, abstain_reason=reason))

    try:
        # 1. Plan
        yield _stage("planning")
        plan = await plan_research(question, usage)
        sub_queries = plan.sub_queries
        yield ("plan", {"subQueries": sub_queries})
        if not plan.in_scope:
            logger.info("Deep research abstained: planner scope=%s", plan.scope)
            yield ("sources", {"sources": []})
            yield abstain(AbstentionReason.OUT_OF_SCOPE)
            yield done()
            return

        # 2. Search — the question itself runs alongside its sub-queries, so the
        # pool is never narrower than what /answer would have retrieved.
        queries = [question, *sub_queries]
        yield _stage("searching", f"{len(queries)} queries")
        # The pinpoint lookup (an article or rule section the question names
        # precisely, read from PostgreSQL) runs alongside the searches.
        (ranked_sets, degraded), pinpoints = await asyncio.gather(
            retrieve_all(queries), fetch_pinpoint_passages(queries)
        )

        # 3. Merge, rerank once, abstain on the RAW top score.
        yield _stage("ranking")
        pool = merge_candidates(
            [r.passages for r in ranked_sets],
            max_candidates=settings.deep_research_max_candidates,
            max_per_document=settings.deep_research_max_per_document,
            max_per_statute=settings.deep_research_max_per_statute,
        )
        pool = add_pinpoints(
            pool, pinpoints, max_candidates=settings.deep_research_max_candidates
        )
        outcome = await rerank_passages(
            question,
            pool,
            top_k=settings.deep_research_top_k,
            timeout=settings.deep_research_rerank_timeout,
        )
        degraded = list(dict.fromkeys([*degraded, *outcome.degraded_legs]))
        # Fail closed: without the cross-encoder the only "top score" is an RRF
        # fusion score, which encodes rank position, not relevance, and clears
        # `abstention_score_threshold` (set for sigmoid rerank scores) almost
        # regardless of the question. On the prod gate 2026-09-28 abs-01 and
        # abs-02 hit the reranker timeout and were answered because of it.
        if _rerank_degraded(outcome.degraded_legs):
            logger.warning(
                "Deep research abstained: rerank degraded (%s)",
                ",".join(outcome.degraded_legs),
            )
            yield ("sources", {"sources": []})
            yield abstain(AbstentionReason.RANKING_UNAVAILABLE)
            yield done()
            return
        reason = check_abstention(
            outcome.passages,
            min_passages=settings.abstention_min_passages,
            top_score=outcome.top_score,
        )
        if reason is not None:
            yield ("sources", {"sources": []})
            yield abstain(reason)
            yield done()
            return

        metadata = await lookup_section_metadata(outcome.passages)
        labelled, context = label_passages(
            outcome.passages, metadata, settings.deep_research_context_tokens
        )
        yield ("sources", sources_payload(labelled))

        # 4. Write
        yield _stage("writing")
        plan_block = "\n".join(f"- {q}" for q in sub_queries) or "(none)"
        written = await _call_llm(
            system_prompt=WRITER_SYSTEM_PROMPT,
            user_prompt=WRITER_USER_TEMPLATE.format(
                context=context, plan=plan_block, question=question
            ),
            model=writer_model,
            max_tokens=settings.deep_research_max_tokens,
            temperature=0.1,
            response_format=WRITER_RESPONSE_FORMAT,
            usage=usage,
        )
        writer_model = str(written.get("model_name") or writer_model)
        version = written.get("model_version")
        model_version = str(version) if version else None
        draft = parse_draft(str(written.get("content") or ""))
        if draft is None:
            logger.warning("Deep research writer returned an unparseable answer")
            yield _stage("verifying")
            yield abstain(AbstentionReason.VALIDATION_FAILED)
            yield done()
            return

        # 5. Verify
        yield _stage("verifying", f"{draft.claim_count()} claims")
        verified, removed, removal_reasons = await verify_draft(draft, labelled, usage)
        logger.info(
            "Deep research verified: kept=%d removed=%d reasons=%s",
            verified.claim_count(),
            removed,
            json.dumps(removal_reasons, sort_keys=True),
        )
        if verified.claim_count() == 0:
            # Nothing survived verification: an answer with no grounded claim
            # is exactly what /answer refuses to deliver, and so does this.
            yield abstain(AbstentionReason.VALIDATION_FAILED, removed)
        else:
            yield ("result", result_payload(verified, removed))
        yield done()

    except BudgetExceededError as exc:
        # Includes ProviderQuotaExhaustedError. No traceback: the breaker logs
        # one ERROR per outage and this fires on every request during it.
        logger.warning(
            "Deep research refused: LLM budget exhausted (scope=%s, period=%s)",
            exc.scope or "global",
            exc.period,
        )
        yield ("error", {"code": "budget_exhausted", "message": _BUDGET_MESSAGE})
    except Exception:
        logger.exception("Deep research pipeline failed")
        yield ("error", {"code": "internal", "message": _INTERNAL_MESSAGE})
