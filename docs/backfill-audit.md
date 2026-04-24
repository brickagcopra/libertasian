# Backfill Engine Audit — 1901-present readiness

Scratch file. Delete at merge time per request.

Scope: verify the pre-existing backfill engine is safe to enqueue historical
year-range batches against LawPhil and Supreme Court E-Library (SCEL).
Branch: `chore/backfill-engine-1901-hardening` from prod HEAD `c0daea1`.

Layout — all paths relative to repo root:

- Task module: `services/worker-service/src/tasks/backfill_tasks.py`
- DB client: `services/worker-service/src/clients/backfill_db_client.py`
- Fetcher base: `services/worker-service/src/fetchers/base.py`
- LawPhil fetcher: `services/worker-service/src/fetchers/lawphil.py`
- SCEL fetcher: `services/worker-service/src/fetchers/supreme_court.py`
- Registry: `services/worker-service/src/fetchers/registry.py`
- Celery Beat schedule: `services/worker-service/src/celery_app.py`
- Prisma model: `apps/api/prisma/schema.prisma:3939-3992`
- Admin controller: `apps/api/src/modules/backfill/backfill.controller.ts`
- Admin service: `apps/api/src/modules/backfill/backfill.service.ts`
- Prior unit tests: `services/worker-service/tests/test_backfill_tasks.py`,
  `services/worker-service/tests/test_fetchers.py`

---

## (a) pending → running transition semantics

A row inserted with `status = 'pending'` does NOT start automatically. The
engine only acts on `enumerating` and `running` rows.

- `enumerate_backfill_candidates` filter: `backfill_tasks.py:101-111` —
  returns `skipped` if `batch.status != 'enumerating'`. Crucially it refuses
  `pending` batches.
- `run_backfill_batch_tick` filter: `backfill_tasks.py:310` — only pulls
  `get_batches_by_status("running")`.
- `check_backfill_budgets`: `backfill_tasks.py:352` — only pulls `running`.

Transition `pending → enumerating` happens via the admin HTTP path:

- `backfill.service.ts:131-133` `start()` → `transition(id, 'pending', 'enumerating')`.
- `backfill.controller.ts:78-96` `POST /admin/backfill/batches/:id/start`.
- Alternative: `backfill.service.ts:79-81` — create-with-`startImmediately=true`
  transitions in the same request.

**Claim semantics:** there is **no `FOR UPDATE SKIP LOCKED`**.
`backfill_db_client.get_batches_by_status` uses a plain `SELECT … ORDER BY
created_at ASC LIMIT 10` (`:58-78`) with no row lock. State transitions are
guarded by an atomic `UPDATE … WHERE id = %s AND status IN (<allowed_from>)`
(`:156-162`) that short-circuits if another worker already transitioned the
batch. This is adequate for today's single-beat-worker layout and becomes
a concern only if we scale beat to multiple replicas. **Not fixing now** —
leave as a known for the followup list.

`enumerate_backfill_candidates` is kicked off today by manual `.delay()` in
the admin service path; there is no auto-dispatch from beat. A pending batch
cannot advance unless an admin calls `/start` or passes `startImmediately`.

---

## (b) enumerate signature vs fetcher signatures

`backfill_tasks.py:156` calls `fetcher.discover(monthly["url"])` —
positional single-URL argument.

- `BaseFetcher.discover(endpoint_url, last_fetched_at=None)` —
  `base.py:203-218`. Second arg is optional. Match is correct.
- `LawphilFetcher.discover(endpoint_url, last_fetched_at=None)` —
  `lawphil.py:54-58`. OK.
- `SupremeCourtFetcher.discover(endpoint_url, last_fetched_at=None)` —
  `supreme_court.py:47-52`. OK.

**Gap (critical):** `_build_lawphil_monthly_urls`
(`backfill_tasks.py:43-61`) is the ONLY URL builder. It is wired into
enumeration at `:145-150` unconditionally — the task never branches on
`parser_type`. A SCEL batch will therefore attempt to `discover()`
`https://lawphil.net/...` URLs using `SupremeCourtFetcher`, which cannot
parse LawPhil HTML and returns zero candidates for every month. The batch
transitions to `running` with `candidates_discovered = 0` and then
immediately `completed` on the first tick — silent zero-yield. This will
break every SCEL pilot batch. **Fix required.**

---

## (c) Empty months (WWII gap, pre-1920 sparse coverage)

Currently handled, but silently.

- `backfill_tasks.py:166-172` — per-month exception swallow with a WARN log
  and continues. No crash.
- `lawphil.py:74-83` — HTTP ≥ 400 returns `[]`. Exceptions during fetch
  return `[]` via broad `except Exception`.
- `supreme_court.py:66-75` — same pattern.

**Gap (minor):** empty months are indistinguishable in the final batch row
from "month fetched OK, no decisions that month" and "page 404'd." Admins
reviewing a completed 1941-1945 batch cannot tell whether zero-yield means
"WWII, genuinely no decisions" or "URL pattern wrong and every month
errored." Add a per-month status counter in `checkpoint_state` and a
`candidates_skipped += 1` increment for not-found months. **Fix: low risk,
high operator value.**

No crash today; safe-ish to run as-is, just opaque.

---

## (d) HTTP 404 / Cloudflare / 2xx empty — resume semantics

**404:** `base._fetch_with_retry` returns 404 responses immediately
(`base.py:175-176`); fetchers log a WARN and return `[]`
(`lawphil.py:74-83`, `supreme_court.py:66-75`). `enumerate` continues.
Checkpoint state captures only the list of discovered candidates and a
`current_index` cursor (`backfill_tasks.py:174-179`); on resume the tick
picks up where `current_index` left off. **A mid-enumeration crash
re-runs enumeration from scratch** because enumeration writes the
candidate list once at the end (`:181`) — not incrementally. Acceptable
for LawPhil since enumeration is bounded by ~12 HTTP GETs per year (fast).
For a full 1901-present batch that's ~1500 HTTP GETs — ~50 minutes at
the 2s rate limit. A crash half-way through means 25 wasted minutes of
fetches, not a correctness bug. Not fixing.

**Cloudflare challenge:** The shared helper `is_cloudflare_challenge`
exists at `base.py:89-96` and `CloudflareBlockedError` at `:61-86`.
`OfficialGazetteFetcher` and `CongressFetcher` both raise it — see tests
at `test_fetchers.py:484-556`. **LawphilFetcher.discover does NOT call
`is_cloudflare_challenge`**. A LawPhil page that returns 200 with CF
challenge HTML (Turnstile interstitial) would parse as "no table, no
candidates" → silent zero-yield. LawPhil has been behind CF intermittently
in the past (moved in and out in 2023-2024). **Fix required.**

**2xx with empty body:** `BeautifulSoup("", "lxml").find("table",
id="s-menu")` returns `None` — falls through to the year-index fallback
at `lawphil.py:95-143` which also yields zero. Returns `[]` cleanly.
No crash.

---

## (e) PDF vs HTML routing

`fetch_content()` assumes HTML for both fetchers:

- `lawphil.py:152-168` — decodes response body as `windows-1252` regardless
  of `Content-Type`. A PDF URL returned by `discover()` (LawPhil rows
  optionally carry a PDF sibling link — see `lawphil.py:286-290` docstring
  of `_parse_table_row`) would be decoded as garbled windows-1252 text.
- `supreme_court.py:111-124` — uses `response.text`, which is httpx's
  default-codec decode of PDF bytes. Same problem.

However, reading `_parse_table_row` at `lawphil.py:292-341` carefully: it
extracts `href` only from the FIRST `<a>` tag inside the first `<td>`
(the case-number cell). The PDF sibling link lives in the third `<td>` and
is ignored. So in practice today, only `.html` URLs reach `fetch_content`.
No PDF path is exercised.

**Gap (design, not bug):** there is no OCR routing. A future change that
adds PDF links to the candidate set would silently produce garbage. Out of
scope for this PR — flagging for the known-not-yet-handled list.

---

## (f) Budget halt cleanliness

`check_backfill_budgets` transitions batches to `halted_budget`
(`backfill_tasks.py:395-401`) via the atomic `transition_batch` guarded by
`VALID_TRANSITIONS` (`backfill_db_client.py:23-30`). `running → halted_budget`
is an allowed move. `halted_budget → running` is also allowed — so resuming
a halted batch via the admin `/resume` endpoint
(`backfill.service.ts:139-153`) works. Cursor (`checkpoint_state.current_index`)
is never reset on halt. **Clean — no fix needed.**

Tick-time budget check also halts cleanly (`backfill_tasks.py:234-241`),
same transition path.

**Minor:** `check_backfill_budgets` runs every 5 minutes per the beat
schedule; between ticks a batch can continue creating child ingestion
jobs even if budget is already exhausted, up to one tick's worth
(~max 5 jobs). `_tick_single_batch` does its own remaining-budget check
at `:234-241` so the slippage is bounded. Acceptable.

---

## Summary of findings

| # | Severity | Path | Fix status |
|---|---|---|---|
| 1 | Critical | enumerate hardcodes LawPhil URLs — SCEL batches silently yield 0 | Fix |
| 2 | High | LawphilFetcher doesn't detect Cloudflare challenge | Fix |
| 3 | High | LawphilFetcher lxml parse chokes on malformed pre-2000 HTML | Fix (html5lib fallback) |
| 4 | Medium | SCEL has no `MIN_SUPPORTED_YEAR` floor — pre-JSP years silently 0 | Fix (provisional floor 1996) |
| 5 | Low | Empty months indistinguishable from 404 months in final counters | Fix (per-month status in checkpoint + `candidates_skipped` bump) |
| 6 | Low | admin DTO requires UUID `sourceId`; no slug-based QoL path | Fix (accept `sourceSlug` as alternative) |
| — | Info | No `FOR UPDATE SKIP LOCKED`; fine for single-beat-worker | Deferred |
| — | Info | Enumeration not incrementally checkpointed; crash = restart | Deferred |
| — | Info | PDF URLs would decode as windows-1252 garbage — no OCR routing | Deferred (not reachable today) |

The admin `POST /admin/backfill/batches` endpoint **already exists** at
`backfill.controller.ts:40-64`. The task prompt listed "add" the endpoint;
in practice the work is extending its DTO to accept a `sourceSlug`
(`lawphil` | `scel`) as an alternative to the UUID `sourceId`. This is
what's shipping.
