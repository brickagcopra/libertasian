# RAG answer-quality evals

A repeatable measurement of `/answer` quality against a fixed golden set. Run
it before and after a retrieval, reranking, or prompt change, then diff the two
result files.

```
evals/
  golden/answers.jsonl  45 questions: 40 answerable (5 per bar subject) + 5 must-abstain
  run.py                CLI: calls the internal rag-service API, writes a result JSON
  metrics.py            pure metric functions (unit-tested)
  compare.py            diffs two result files -> Markdown
  model.py              golden/result parsing
  results/              run outputs (git-ignored)
  tests/                unit tests, no network
```

The harness uses only the stdlib and `httpx`, and never imports from `src/`. It
measures the service over HTTP, the same way the NestJS gateway sees it.

## What gets measured

| metric | definition |
|---|---|
| `authority_hit@k` (k = 1, 3, 8) | Share of answerable questions where any `expected_authorities` entry matches one of the top-k `sources`. Errored runs are excluded. |
| `answer_rate` | Share of answerable questions that were answered and not abstained. |
| `abstention_precision` / `abstention_recall` | The positive class is `must_abstain`. Precision is the share of all abstentions that were on must-abstain questions. Recall is the share of must-abstain questions that abstained. |
| `citation_validity_rate` | Sum of `citations[].valid` divided by the number of citations, over answered questions. |
| `latency_p50_ms` / `latency_p95_ms` | Client-side wall time per request, linear-interpolated percentiles. |
| `n_error`, `n_degraded` | Requests that failed (non-200 or transport error), and responses with a non-empty `degraded_legs`. |

Each metric is also broken down per subject.

**Authority matching is done per document.** `/answer` sources include
`title`, `citation_text` and `document_type`, but not the article or section a
passage came from. So `{"statute": "Family Code Art. 36"}` counts as a hit when
a Family Code document appears in the top-k. The article is kept for the human
reviewer. Matching rules:

- `gr_no`: G.R. numbers are normalised with the same regex as
  `worker-service/src/normalizers/text_normalizer.py::normalize_gr_no`. A test
  reads that file and fails if the two regexes drift apart. Matching also
  accepts `G.R. Nos.` and the pre-1987 `L-` prefix. Consolidated suffixes are
  ignored, so `146710-15` matches on `146710`.
- `statute`: this is the text before `Art.`/`Sec.`/`Rule`. A numbered
  instrument such as `R.A. No. 9262` or `P.D. No. 442` matches the same
  instrument in any spelling (`Rep. Act No.`, `Pres. Decree No.`, …). A named
  one such as `Family Code` or `Rules of Court` must appear as a whole phrase
  in the title or citation.
- `title_contains`: a whole-word match against the title. It ignores case and
  accents.

## Golden set

Each line in `golden/answers.jsonl` has this shape:

```json
{"id": "civ-01", "question": "...", "subject": "Civil Law",
 "expected_authorities": [{"gr_no": "G.R. No. 196359"}, {"statute": "Family Code Art. 36"}],
 "must_abstain": false, "notes": "...", "reviewed": false}
```

- `subject` must be one of `Political Law`, `Labor Law`, `Civil Law`,
  `Taxation Law`, `Mercantile Law`, `Criminal Law`, `Remedial Law`, or `Legal Ethics`.
- Authorities are identified by G.R. number, statute, or title, **never by
  database id**, because ids differ between environments.
- `reviewed` stays `false` until a lawyer has checked the entry. Entries whose
  G.R. number is not certain say so in `notes`.
- `tests/test_golden.py` enforces the shape and the 40/5 split across all 8
  subjects.

Changing the golden set changes the metrics. Every result file records
`golden_sha256`, so only compare runs whose hash matches.

## Running on prod

The rag-service image ships `src/` only, so first copy the harness into the
running container. Run these from the repo checkout on the prod host.

**Use `--concurrency 1` for BOTH endpoints (`answer` and `deep`), and wait for
the reranker to be idle before each pass.** reranker-service scores ONE request
at a time, at ~12s per 30-40 passages on CPU, and it serves live /answer
traffic too. Every eval question makes at least one rerank, so with two in
flight one of them waits ~12s for the model, and the rag client's 20s budget
(`RAG_RERANKER_TIMEOUT`) counts that wait. On prod 2026-09-28 overlapping
reranks built a 540s queue on the reranker, and every /answer in that window
(eval rows and real users alike) fell back to RRF (`reranker:unreachable`).
A run measured that way measures RRF, not the ranker, and it degrades the
product while it runs. Waiting for idle between passes keeps the tail of one
pass from bleeding into the first questions of the next:

```bash
# Idle = the reranker container under 5% CPU on 3 consecutive samples.
wait_reranker_idle() {
  n=0
  while [ "$n" -lt 3 ]; do
    cpu=$(docker stats --no-stream --format '{{.CPUPerc}}' libertasian-reranker-service | tr -d '%')
    if [ "${cpu%.*}" -lt 5 ]; then n=$((n + 1)); else n=0; fi
    sleep 5
  done
}
```

```bash
# 1. Copy the harness in. docker cp nests into an existing dir, so clear it first.
docker exec -u root libertasian-rag-service rm -rf /tmp/evals
docker cp services/rag-service/evals libertasian-rag-service:/tmp/evals

# 2. Run it. The container already has RAG_INTERNAL_API_KEY, and run.py sends it as
#    X-Internal-Api-Key (the header src/shared/auth.py checks).
wait_reranker_idle
TS=$(date -u +%Y%m%dT%H%M%SZ)
docker exec -w /tmp libertasian-rag-service sh -c \
  "python -m evals.run --base-url http://localhost:8000 \
     --api-key \"\$RAG_INTERNAL_API_KEY\" --endpoint answer \
     --out /tmp/rag-evals/$TS.json --concurrency 1"

# 3. Copy the result out.
mkdir -p services/rag-service/evals/results
docker cp libertasian-rag-service:/tmp/rag-evals/$TS.json services/rag-service/evals/results/
```

Notes:

- Results are written to `/tmp/rag-evals/` inside the container. The app runs
  as the non-root `appuser`, and `/tmp` is the writable location. The file is
  lost when the container is recreated, so copy it out.
- `--limit 5` or `--ids civ-01,abs-03` runs a quick smoke test first.
- Progress goes to stderr, one line per question. The Markdown summary goes to stdout.
- Each question makes a real generation call. The request bypasses NestJS, so
  no user quota is charged, but the LLM spend is real. A `503` from the budget
  guard is recorded as an `error` row, not as a miss.
- On prod, `--concurrency 1`, always. The harness default of 2 is for a local
  stack. See the top of this section for why.
- From another container on the `ai` network, use
  `--base-url http://rag-service:8000`.

## Comparing runs

```bash
cd services/rag-service
python -m evals.compare evals/results/<baseline>.json evals/results/<candidate>.json [--k 3]
```

The output is Markdown and can be pasted into a PR. It contains:

- overall metric deltas
- per-subject hit@k and answer-rate deltas
- the questions that flipped: `hit@k -> miss`, `miss -> hit@k`,
  `answered -> abstained`, `abstained -> answered`, `ok -> error`, and `error -> ok`

Metrics are recomputed from the per-question rows, so older result files are
scored on the current definitions.

## Deep Research (`--endpoint deep`)

`--endpoint deep` posts `{"question": ...}` to `POST /research/deep` and reads
the SSE stream to its end, so `latency_ms` is the full answer, not time to first
byte. The stream is reduced to the same `QuestionResult` row as `/answer`:

| Result field | From the stream |
|---|---|
| `sources` | `sources` event, S1..Sn in final-rerank order. `gr_no` = `grNo`, else parsed from citation/title as for /answer. `rerank_score` is null (not on the event). |
| `status` / `abstain_reason` | `result.abstained` / `result.abstainReason`; an `error` event (or no `result`) is `error` |
| `citations_total` / `citations_valid` | citations in the delivered `result`; valid = `sourceId` names a delivered source and a quote is present |
| `model_name`, `degraded_legs` | `done.modelName`, `done.degradedLegs` |

So `evals.compare` diffs a deep run against an answer run directly:

```bash
wait_reranker_idle
TS=$(date -u +%Y%m%dT%H%M%SZ)
docker exec -w /tmp libertasian-rag-service sh -c   "python -m evals.run --base-url http://localhost:8000      --api-key \"\$RAG_INTERNAL_API_KEY\" --endpoint deep      --out /tmp/rag-evals/$TS-deep.json --concurrency 1 --timeout 300"
docker cp libertasian-rag-service:/tmp/rag-evals/$TS-deep.json services/rag-service/evals/results/
python -m evals.compare evals/results/<answer-run>.json evals/results/$TS-deep.json --k 8
```

A Deep Research question makes exactly one rerank. Its sub-queries return fused
RRF candidates, and only the merged pool (at most
`RAG_DEEP_RESEARCH_MAX_CANDIDATES`, default 40) is reranked. That one call is
the largest the reranker sees, so run the deep pass at `--concurrency 1`, after
`wait_reranker_idle`, and never overlapping the answer pass.

`--model-override gpt-6-luna` runs the writer on another model; the server
must list it in `DEEP_RESEARCH_MODEL_ALLOWLIST`, or every row is an HTTP 422 error.

## Adding an endpoint

`run.py` keeps a registry, `ENDPOINTS: {name: Endpoint(path, build_payload, parse_response, streaming)}`.
Write a payload builder and a parser that returns `ParsedResponse` (it gets the
JSON body, or the list of `(event, data)` pairs when `streaming=True`), then
register them. The runner, metrics and compare step need no changes.

## Tests

```bash
cd services/rag-service
uv run pytest -q evals/
uv run mypy --strict evals
```
