# LIBERTASIAN — Pending Tasks

> Last updated: 2026-08-04 (**new, top of the list:** `fix/rag-opensearch-tls-auth` — the RAG service's OpenSearch client had neither credentials nor a TLS setting while prod serves https + self-signed + basic auth, and the client turned every failure into an empty hit set. Fixed locally; **the prod confirmation is an op, and it is the only thing that proves any of it.** See the section directly below.)
>
> Previously: 2026-08-03 (**was top of the list:** three PRs are open and CI-green and none is merged — **#353** digest-tab visibility, **#354** the case-digest search corpus, **#355** the mobile pill nav. #354 does nothing for users until an **index-rebuild job runs on prod after deploy**; #355 is JS-only and rides the next EAS build or OTA. See the section directly below.)
>
> Previously: 2026-08-01 (**new, top of the list:** the store-compliance epic — 4 PRs standing between a submitted-but-unreviewed app and a pass. **PR 1 (#343) is up:** self-serve account deletion, which Apple 5.1.1(v) and Play both require and which did not exist. PRs 2–4 (in-app delete UI, removing Apple 3.1.1 purchase entry points, Android 15 edge-to-edge + ASC screenshot sizes) follow in order. **No EAS build is cut by any of them.**)
>
> Previously: 2026-07-29 (#336 OPEN — the flat 300 s synthesis timeout made a 2,238-char digest permanently unsynthesizable and burned 15 min of 8-core CPU proving it three times. Budget is now length-proportional, retries are classified, and the failure reason is persisted. Plus a **separate** CUDA image for the rented-GPU tier-1 backfill and bearer auth on the TTS hop, both no-ops for prod. **Nothing is deployed and no flag is flipped.** See the audio section.)
>
> Previously: 2026-07-29 (#334 OPEN — the Kokoro tts-service ran on prod for the first time and **synthesis did not work at all**: a missing spaCy model made every `/synthesize` return 500 while `/health` stayed green. Fixed and verified offline, plus two capacity constants that were wrong by ~3.7x, and audio object storage routed to Cloudflare R2 behind an unset-by-default env var. **Nothing is deployed and no flag is flipped.** See the audio section.)
>
> Previously: 2026-07-27 (**was top of the list:** #322 MERGED `5addc51` — an unreachable auto-publish gate had kept 76% of the corpus out of search since 2026-05-30. **Dry run over prod is in: 11,561 of 13,093 drafts would publish (88.3%), all held by the citation gate alone; 1,532 to review, 0 quarantine.** The `--apply` is the outstanding prod op. #321 opened for the resolver underneath it, #323 for the 1,531 rows still blocked on a null `court`. Previously: #319 MERGED `d1c3343` — essays were storing fabricated section IDs, 59.2% of 67,515 citation refs resolved to no section row, and the essay scorer counted a non-empty list without checking it. #317 merged, #318 merged with the MCQ row struck, #316 closed, #320 opened for the 170 published essays. **#319's acceptance evidence is still outstanding: `essay_generation.v2` has no rows yet, so the fix is deployed but unverified.** See the top section.)
>
> Previously: 2026-07-26 (search Phases A–C3 all merged: #306 #307 #308 #310 #311 #312; C3 squashed to `025e538`, deployed and live-verified on prod. Remaining search work is a client UI for `scope` and C4 fusion behind the reranker — but see the reachability note first: only 13,017 of 99,994 derivatives match any visibility branch. Also new: #313 fixed the confidence scorer, #315 gated the re-score script, and the re-score itself is CLOSED as not worth running — 7 rows of 29,471 move. What replaces it is a product decision about what the 0.70 editorial bar should mean; see the top section.)

Verification rules used for this prune: every PR reference checked with `gh pr view <n> --json state,mergedAt`; every branch reference checked against `git branch -r --no-merged origin/main` after `git fetch --prune`. Items that could not be verified were MOVED to "Needs verification", not deleted.

---

## Bar exam answer confidence (`feat/bar-exam-answer-confidence`, 2026-08-05) — the pilot is the gate

Details in COMPLETED_TASKS.md under 2026-08-05. PR 3 (bulk generation + auto-approve) is **blocked** until the pilot numbers exist and have been read.

- [ ] **Run the 50-question pilot on prod after this deploys — this is the deliverable's whole point.** `force_regenerate` exists in `bar_exam_answer_tasks.py`, so the 5 pending rows are re-runnable if the first pass is bad. Then: `uv run python -m src.scripts.score_bar_exam_answers_dryrun --pilot` (read-only, safe against prod).
- [ ] **Read "retrieval succeeded" off the prompt version, not the score.** A v2 row that scores 0.0 retrieved eight passages and cited none of them; a v1 row written after the deploy is a genuine retrieval miss. Collapsing those two into one number hides which half is broken.
- [ ] **Read the BY DENOMINATOR block before the aggregate.** The bar is adaptive: validated on prod over 64 questions, the denominator is 3 for 66% of questions, 2 for 31%, 1 for 3%. At denominator 2 **one clean citation scores 0.75 and passes**; the same answer at denominator 3 scores 0.667 and fails. The aggregate pass rate is the number most likely to be quoted and the least likely to mean what it appears to — it mixes answer quality with retrieval breadth, and breadth varies by subject (legal_ethics 2.9 distinct documents, criminal_law 5.0).
- [ ] **If nothing clears 0.70, that is a finding about the scorer.** CLAUDE.md: prefer fixing what the terms measure over moving the threshold. The per-term min/median/max in the report is the diagnostic — a term whose min equals its max is the thing to replace.
- [ ] **The 58 existing rows will rescore to 0.000 and that is correct.** They are priors-only with no `citedSectionIds` at all. Note that 53 of them are already **approved and public**, published with no measured grounding — deciding what to do about that is an editorial call, not a scoring one.
- [ ] **Retrieval-side diagnostics (BM25 spread, relevance-floor counts) are not available from stored rows.** The retrieved passage set is not persisted anywhere, and the obvious home — `structured_answer_json` — is served verbatim to the public endpoint (`bar-exam-answers.public.controller.ts:126`), while `model_runs` has no metadata column. Getting them is a schema decision. The generation task logs the per-answer term breakdown in the meantime.
- [ ] **`services/worker-service/tests/test_parsers.py` does not compile** (a string literal, `* 10`, then an adjacent literal ≈ line 83). The **entire worker-service suite fails collection** because of it — 1,002 tests unrunnable without `--ignore`. Pre-existing since `5c5596b` and untouched by this PR, but combined with `ci.yml` running no Python tests at all, it means the Python quality signal has been off. One-character fix; worth its own PR alongside wiring the Python suites into CI.

## RAG ↔ OpenSearch connectivity (`fix/rag-opensearch-tls-auth`, 2026-08-04) — MERGED `ae473ad`, deploy is server-side

Details in COMPLETED_TASKS.md under 2026-08-04. Merged 2026-08-05; prod deploy is handled on the server, not from here.

- [x] **Confirmed on prod 2026-08-05 (brick).** Traceback from inside the container: `httpx.ConnectError [SSL: CERTIFICATE_VERIFY_FAILED]`, swallowed into an empty hit set. Both arms tested: `verify=False` alone → **401**; `verify=False` + basic auth → **200, 10k+ hits**. Both are required.
- [ ] **Deploy rag-service and read the startup line.** `OpenSearch connected: opensearch <version> at https://opensearch:9200 (verify_ssl=False, auth=yes)` is the pass condition. `OPENSEARCH UNREACHABLE` names the env vars to check. **`auth=no` is the failure mode to watch for** — it means neither credential pair resolved, and the fix is inert (the service will get a 401 instead of a TLS error). No compose or `.env` change is needed for this deploy; the container already carries `OPENSEARCH_USERNAME`/`OPENSEARCH_PASSWORD`.
- [ ] **Then re-run one query per surface** (`/answer`, a memo, flashcards) and check the passage counts are non-zero. Every one of those has been returning zero passages, and a green deploy alone does not prove otherwise — that is precisely the mistake the Kokoro `/health` episode already cost us once.
- [ ] **Retrieval failures are now 500s, not empty answers.** That is the point of the change, but it is a visible behaviour change for the API gateway: a NestJS call that used to receive a confident abstention will now receive an error. Check `apps/api`'s RAG client handles a 5xx from the Python hop with a sensible user-facing message before this reaches users.
- [ ] **Nothing measures how long this was broken.** `docker compose logs rag | grep -c "OpenSearch search failed"` over retained logs is the closest available signal, and every hit is a query answered with no sources. Worth one look — it sizes the blast radius on real user traffic and tells us whether any published artifact was generated priors-only.
- [ ] **`RAG_OPENSEARCH_VERIFY_SSL=false` is a deliberate hole with a real cost.** It is defensible on a container network with a self-signed cert, and it is still an unauthenticated-peer connection carrying admin credentials. Issue a real cert for the cluster and flip the flag; the setting exists so that day is a config change, not a code change.
- [ ] **`tests/test_routers.py`'s 40 errors are pre-existing and nobody is watching.** The `client` fixture needs `@pytest_asyncio.fixture`. Trivial — but it means 40 router tests have not run for some time, and **`ci.yml` runs no Python tests at all**, so nothing would have said so. The bigger item is wiring the four Python services into CI.

## Three open PRs from 2026-08-03 — merge order matters (do this second)

All three are branched from `main` and CI-green (17/17 each). Nothing is merged and nothing is deployed. Details in COMPLETED_TASKS.md under 2026-08-03.

- [ ] **Merge #353** (`fix/digest-tab-visibility`, api, 2 files). Unhides 3,521 digests the search Digests tab was filtering out by `review_status` — coverage of published decisions goes 77% → 98%. No client change needed; mobile and web already badge `reviewStatus`. Needs an api deploy to take effect.
- [ ] **Merge #354** (`feat/case-digests-search-corpus`, 27 files). First index over the 16,995-row `digests` table; before this, no query could match digest text at all. **After deploy, an index-rebuild job must run on prod — brick's call, brick runs it.** Until it does, `scope=digests` returns an empty corpus and the rewired Digests tab shows nothing, which is worse than the current behaviour. **Do not merge #354 without scheduling that rebuild.**
- [ ] **Merge #355** (`fix/mobile-pill-nav-all-tabs`, mobile, 16 files, JS-only). Test-merges cleanly with #354 despite both touching `(tabs)/search.tsx`.
- [ ] **Eyeball the eight-slot pill on a 360pt Android screen.** The no-clipping requirement is asserted structurally (`numberOfLines={1}`), not visually. Fold into the next preview-build QA pass rather than cutting a build for it.
- [ ] **#354 leaves `GET /digests/search` as-is** (`title ILIKE '%q%'` over `"Digest: <CASE CAPTION>"` titles). It is now redundant with the new corpus for every caller that can pass a scope. Decide whether to point it at the index or retire it — not urgent, but it is a second search path that will drift.

## Store compliance epic — 4 PRs, in order (2026-08-01)

The app is **submitted but unreviewed**: iOS build 11 in TestFlight (ASC app `6788971669`), Android versionCode 6 uploaded to Play. Four things stand between that and a pass. Each is its own PR, branched from `main` and merged before the next. **No EAS build is cut by these PRs** — brick does that once all four are on `main`.

- [x] **PR 1 — `feat(api): self-serve account deletion` (#343).** Apple 5.1.1(v) + Play data-deletion. `DELETE /users/me` and `POST /users/me/deletion/cancel`, 30-day restore window, daily purge cron + idempotent BullMQ job. Matches the already-published `/account-deletion` copy, so that page needed no edits. **Xendit is called only for a non-NULL `xenditSubscriptionId`** — the reviewer account's comp Pro grant has a NULL one.
- [x] **PR 2 — `feat(mobile,web): in-app Delete Account UI` (#344, merged `9861c05`).** Mobile `settings/delete-account.tsx` + a red danger-zone entry below Sign out; two-step confirm; signs out and clears MMKV/SQLite. Web: same flow in settings, and `/account-deletion` copy moves from "email us" to "Settings → Delete account (or email support)". **Keep the URL** — Play's data-safety form points at it.
- [x] **PR 3 — `fix(mobile): remove external purchase entry points` (Apple 3.1.1).** Delete `useCreateCheckout` + the `Linking.openURL(result.checkoutUrl)` in `settings/plans.tsx:189-192`; that screen becomes a read-only view of the current plan. Sweep the 21 `.tsx` files carrying upgrade/₱/subscribe copy so every paywalled surface reads "Not included in your plan." with no price and no outbound link. **`apps/api` and `apps/web` are untouched — web keeps selling.**
- [ ] **PR 4 — `fix(mobile): Android 15 edge-to-edge + store screenshot sizes`.** targetSdk 35 draws under the system bars and only `settings/plans.tsx` uses `useSafeAreaInsets` today; replace hardcoded `paddingTop` in 13 screens and fix `scan/capture.tsx` + `scan/upload.tsx` (RN `SafeAreaView` is a no-op on Android). iOS must look identical. Add 6.9" iPhone (1320×2868) and 13" iPad (2064×2752) to `assets/store/screenshots.config.json` and regenerate — ASC requires both for a new app.

### Open questions surfaced by PR 3, for brick

- [ ] **The e2e suite had never run, and 17 of its 53 suites are broken.** `apps/api/jest.config.ts` has `rootDir: 'src'`, so `test/*.e2e-spec.ts` was never discovered by `pnpm test` — the whole directory sat unexecuted. PR 3 measured it: the full AppModule boots on the postgres + redis containers CI already declares (**no OpenSearch, MinIO or ClamAV needed**), and **1,022 of 1,081 tests pass**. The remaining **58 failures across 17 suites** are pre-existing rot, not regressions from any recent branch: `auth` fails one refresh-race assertion, `documents` gets 402 where it expects 404 (entitlement drift), `search` almost certainly wants OpenSearch. Seeding the DB first does not help (58 vs 57 failures). CI now runs `account-deletion.e2e-spec.ts` only, with the exclusion and its measured numbers stated in `.github/workflows/ci.yml`. **Repair those suites and widen that list** — until then most of the e2e directory is decoration.
- [ ] **The mobile app can no longer tell a user how to subscribe, at all.** That is the correct reading of Apple 3.1.1 / Play Payments and it is what shipped, but it is a real product cost: a free user on mobile has no path to paying and is not told one exists. The web app still sells. If conversion matters more than the strictest reading, the options are (a) Apple/Google in-app purchase, paying their cut, or (b) a "manage your account on the web" line with no pricing and no link — riskier, and Apple has rejected exactly that wording before. Product decision, not an engineering one.
- [ ] **`src/app/billing/mobile/*` deep-link bounce screens are now unreachable from the app.** They existed to catch the return from a mobile-initiated checkout. They are harmless, and still useful if a user buys on the web on their phone, so PR 3 left them. Delete them only together with the web bounce pages they pair with.

### Open questions surfaced by PR 1, for brick

- [ ] **Restore is only reachable for ~15 minutes.** `DELETE /users/me` revokes every refresh family and login refuses a non-`active` status, so `POST /users/me/deletion/cancel` works only while the caller's existing access token is alive. That covers an in-app "Undo", not a user who changes their mind on day 20 — that case needs support today. Widening it means letting `pending_deletion` accounts obtain a restricted token, which is a deliberate change to the auth status gate.
- [x] **Run the new e2e suite in CI.** Done in PR 3, and the "needs the full compose stack" assumption was wrong: postgres + redis alone are enough. All 14 account-deletion e2e tests pass. See the PR 3 section above for the 17 suites that do not.
- [ ] **`prisma migrate deploy` for `20260801120000_add_user_account_deletion`** in staging and prod before the mobile UI ships. Additive only (3 nullable columns + 2 indexes on `users`, 1 nullable column on `organizations`), verified against a throwaway PG16 with no drift.

---

## Audio / Kokoro — #336 open: the GPU backfill route (2026-07-29)

The tier-1 backfill moves to a rented GPU; prod keeps steady state. #336 ships the image, the auth, and the timeout model. It flips nothing.

- [x] **The timeout was a flat 300 s for every request, and that was the cliff.** Digest `0a8d731f-8b21-4332-b001-93779ebdf054` (2,238 chars, near the 2,032-char corpus average) needs ~166 s of audio and ~184–232 s of CPU wall clock; queueing pushed it past 300 s and **all three attempts used the same doomed budget** = 15 min of 8-core CPU for nothing. Budget is now `max(60s, chars / 13.5 x KOKORO_REALTIME_FACTOR)` — 414 s for that digest, 903 s for the 4,877-char one.
- [x] **Retries are classified.** Transient (network/5xx/429) still gets 3 attempts; a timeout is retried ONCE with a 1.5x budget; 401 / malformed payload / over-ceiling text fail immediately via BullMQ `UnrecoverableError`. `audio_renditions.failure_reason` records which, written on the final attempt and never over a `ready` row.
- [x] **GPU image is a separate file** (`Dockerfile.tts.gpu`); `Dockerfile.tts` still builds today's CPU-only image because prod has no GPU. cu129 wheels — torch 2.13.0 is **not** published for cu128. Built and acceptance-tested (health 200, 401/200 auth paths, 29,088 B mp3 + 16 marks). **The GPU path itself is unverified**: no NVIDIA device on the build host, so throughput and VRAM are still assumptions.
- [ ] **Measure real GPU throughput before sizing anything against it.** Every capacity number in this repo is a CPU measurement. Rent the box, run tier 1, and record items/hour and VRAM per worker the same way prod was measured on 2026-07-29 — the 3.59x-vs-0.97x correction is what this project keeps learning.
- [ ] **Set `KOKORO_REALTIME_FACTOR≈0.25` on the GPU host.** At the CPU default of 2.5 the budget is ~10x too generous there, which also holds the single-call character cap down at ~9,720.
- [ ] **`TTS_AUTH_TOKEN` is effectively mandatory on the rented box** (same value on API and TTS side). Unlike prod, port 8003 is reachable off-host; unset means serving synthesis to whoever finds the port. Both sides no-op when unset, so prod stays as-is.
- [ ] **Tier 3 decisions now fail fast rather than time out.** At the default factor one call caps at ~9,720 chars, below the ~25,600-char decision average, so decisions record `text_too_long` instead of burning 15 min to reach the same failure. **The real fix is chunked synthesis** — one HTTP call per document does not survive a 25,600-char document at any factor. Not in #336.
- [x] **The device is no longer implicit.** `KPipeline` was built with no `device`, so kokoro's internal `cuda if available else cpu` decided it and reported nothing — a GPU deployment could only be inferred from throughput. `TTS_DEVICE` now resolves explicitly (unset/`auto` → cuda when torch sees a device, else cpu), is logged at startup, and **`/health` returns `device`, `cuda_available`, `device_name`, `workers`, `threads_per_worker`**. `device=cuda` + `cuda_available=false` is the misconfigured-container state that used to be invisible.
- [x] **Worker/thread shape is device-aware.** Unset resolves to 2 x 4 on CPU (the measured prod shape) and **1 x 8 on CUDA** — one process owns the card, because workers do not share the model. `src/serve.py` resolves the device before launching uvicorn, which a shell `--workers ${TTS_WORKERS:-N}` cannot do; the CPU image keeps its shell CMD. An explicit `TTS_WORKERS>1` on CUDA is honoured (multi-GPU is legitimate) with a warning.
- [ ] **Set `AUDIO_PROCESSOR_CONCURRENCY=1` when the TTS host runs a single worker.** `/synthesize` calls `synthesize_document` synchronously inside an `async def` handler, so one worker serializes synthesis AND cannot answer `/health` while a synthesis is in flight. Extra in-flight jobs buy nothing on a 1-worker host; they queue inside the service. Do not read one failed health probe mid-backfill as the service being down.
- [ ] **Consider `asyncio.to_thread` for the synthesis call** (CLAUDE.md's own Python standard for CPU-bound blocking work). It would keep `/health` responsive during synthesis and make a single-worker GPU host behave predictably. **Needs care, not a one-liner:** `KPipeline` is not documented thread-safe, so it wants an `asyncio.Lock` to keep synthesis one-at-a-time per process. Deliberately out of #336 — it changes the CPU service's concurrency behaviour, which that PR holds fixed.
- [ ] **A `failed` rendition is re-enqueued only after its BullMQ job leaves the retained failed set** (`removeOnFail: 500`), because the deterministic jobId is the dedupe key. Pre-existing, but reached sooner now — read the reconciler's gap counts with that in mind.

## Audio / Kokoro — #334 open, prod ops outstanding (2026-07-29)

Measured on the prod box, not assumed. #334 fixes the blocker and corrects the constants; it flips nothing (`TTS_PROVIDER=polly`, all three reconciler flags `false`, all five `AUDIO_S3_*` unset).

- [x] **The blocker: every `/synthesize` returned 500.** kokoro's G2P calls `spacy.cli.download()` at runtime when `en_core_web_sm` is missing; the runner has no pip/uv and is non-root, so spaCy `sys.exit(1)`s. `/health` returned 200 the whole time because G2P inits lazily — **a green health check proved nothing about this service.** Model now locked as a dependency; must move with spacy's minor version (3.8.x ↔ 3.8.14).
- [x] **Weights baked into the image** after `USER appuser`. `HF_HOME` was empty with no volume behind it, so weights re-downloaded on every recreate and the service could not start with HF unreachable. **Acceptance passed offline** (`docker run --network none`): `/health` 200 **and** a 3-segment `/synthesize` → 27.98 s of audio, 48.6 kbps, 3 ssml + 62 word marks.
- [x] **Two constants were wrong.** Throughput is **~0.97x realtime** at 4 threads, not the claimed 3.59x (off by ~3.7x). af_heart yields **13.7 chars/audio-second**, not 15.0 — so the reconciler's per-tier estimates are now 116 / 13,000 / 1,870 s and the pinned dry-run expectation is 420.8 h. Memory limit 4G → 8G (one worker peaked at 2.9 GiB). `AUDIO_PROCESSOR_CONCURRENCY` default 2 — BullMQ's default of 1 left one of the two TTS workers permanently idle.
- [ ] **Before setting `AUDIO_S3_ENDPOINT`: copy the 302 existing MinIO renditions to R2 first.** Object keys live in `audio_renditions` and are signed against whichever backend is active *now*, so switching makes every existing key resolve against the new bucket — signed URLs 404 while the rows still read `ready`. **Not self-healing**, unlike the `TTS_PROVIDER` switch (where a distinct `voiceId` produces new rows). No migration script exists yet.
- [x] **CSP now carries the real R2 origin, committed literally** (amended in review). Substituting a placeholder on prod was the wrong plan: `nginx.conf` is tracked and bind-mounted from the repo, so the edit would break the no-edits-on-prod rule and be clobbered by the next `git pull`. The account id is not a secret — it is the host of every presigned URL the browser already receives. Harmless while `AUDIO_S3_ENDPOINT` is unset; the origin is just never contacted.
- [x] **The disk guard now knows storage went remote** (amended in review). Skipped from `AudioStorageService.isRemote` when audio is off-box, so an unrelated local disk issue can no longer halt the backfill; enforced unchanged in local mode. Both tested. A bucket quota/billing check is still the *right* long-term guard — there is now no ceiling of any kind on remote audio volume.
- [ ] **Create the R2 bucket PRIVATE** before setting `AUDIO_S3_ENDPOINT` — presigned GETs only, never a public `r2.dev` domain.
- [ ] **Size tier 3 against ~1x realtime before enabling decisions — this is now the only remaining tier 3 blocker.** R2 resolves the storage half (~158 GB no longer has to fit in ~142 GB free); what is left is compute. At the measured throughput the decision backfill is on the order of **8,000 worker-hours** of synthesis — months of continuous work at 2 workers on a box that also serves the API. The old 3.59x constant understated this ~3.7x. `.env.example` now says compute, not disk, is the gate.

## Search visibility — #322 merged, the apply is still outstanding (do this first)

76% of `legal_documents` (13,093 of 17,135) sits in `status='draft'` and is therefore absent from OpenSearch: searching a stranded document's exact title returns a different case. Cause: `citation_mapping` was a blocking auto-publish check requiring an 80% citation resolution ratio, against a resolver whose measured ratio is median 0.000 / mean 0.024. It failed 13,025 of 13,093 drafts and 3,909 of the 4,042 documents already published. Auto-publish stopped on 2026-05-30 while ingestion ran to 2026-07-10. #322 (`5addc51`) made the check advisory and added the backfill.

- [x] **ACCEPTANCE — dry run over live prod rows: DONE, and it holds.** 13,093 drafts scanned → **11,561 would publish (88.3%), every one held by the citation gate alone**; 1,532 to `human_review`; **0 quarantine**. Of the review rows, 1,531 fail `metadata_confidence` on a null `court` (1,525 are `decision`) and 1 fails `document_complete` on a missing `decision_date`. Nothing unexpected surfaced under `Blocking checks failed` — leaving `metadata_confidence` blocking was right, it is catching real incompleteness rather than phantom failures.
- [ ] **`--apply` the backfill (prod op, brick's call).** Publishes 11,561 documents into the public corpus and fires one OpenSearch index call each.
      ```bash
      cd services/worker-service
      AUTOPUBLISH_BACKFILL_ALLOW_WRITE=1 \
        uv run python -m src.scripts.backfill_autopublish_drafts --apply --limit 50
      ```
      **Run it behind `--limit` first** and confirm those 50 are actually searchable before sweeping 13k rows — the publish and the index call are separate failures. `index_failures` counts documents published in PostgreSQL but NOT in OpenSearch; those need the index trigger re-run. The sweep selects on `status='draft'`, so a resumed run never re-publishes what already landed.
- [ ] **#323 — 1,531 draft decisions blocked only on a null `court`.** Derivable from the source registry and citation text; publishing them afterwards is a re-run of the same backfill, no new code. Note recorded there: `metadata_confidence` requires ≥80% of **three** fields, and 2/3 = 0.667 < 0.8, so it is effectively "all three or fail" — a single null `court` is a hard block, not a partial deduction. Populate the field; do not loosen the check.
- [ ] **#321 — the citation resolver resolves ~0% of ~16 citations per document.** This is the real defect; the search outage was its symptom, and demoting the gate does not fix it. Before any threshold is written against this signal again, measure what share of unresolved citations point at documents not in the corpus at all — that ceiling decides what the ratio can ever mean. Suspects in order: whether `citation.resolve_for_document` is dispatched at all for most docs, whether `normalized_citation` matches the form the resolver looks up, then genuine corpus gaps.
- [ ] **Deliberately out of scope, note if revisiting:** the 3,909 published documents that also fail the citation check are left alone (they are searchable; re-validating could only take that away), and no row is quarantined by the sweep.

## #319 essay citation fix — open follow-ups (do these in order)

- [ ] **ACCEPTANCE STILL OUTSTANDING — `essay_generation.v2` has no rows yet.** #319 is merged (`d1c3343`) and deployed, but **deployed is not verified**. The fix is unproven against live rows until the next essay generation run writes v2 rows and they come back with 0 dangling refs. Nothing about the prod run on 2026-07-27 tested the new code path; it measured the corpus the old one left behind.
      ```bash
      cd services/worker-service
      uv run python -m src.scripts.report_essay_dangling_citations --split-by-version
      ```
      Read it this way: **`essay_generation.v2` should show 0 dangling refs.** A non-zero count there means those rows came from a worker predating the deploy — check `created_at` before reading it as the fix failing. An *absent* v2 bucket means no essays have been generated since the deploy, which is where this sits now — that is "not yet tested", not "passing". The `v1` bucket will not improve; those rows are already written. The script cannot write (no `--apply`, no `UPDATE`, test-enforced), so it is safe against prod.
- [ ] **#320 — the 170 published essays with dangling citations (brick's call).** Aggregate recorded there: 170 of 5,249 `public_editorial` essays (3.2%), mean 1.91 dangling of 5.02 refs, confidence 0.500–1.000. Most are partially grounded, so it is a correction problem more than a retraction one. **4 are fully fabricated** — every ref dangling — and all four scored 0.500. Full per-artifact list regenerates any time with `report_essay_dangling_citations --published`.
- [ ] **#320 — manual approve bypasses the 0.70 bar entirely (arguably the bigger finding).** Two paths reach `public_editorial` and only one reads the score: `auto-promote.service.ts:47-51` gates on `confidenceScore >= AUTO_PROMOTE_CONFIDENCE_THRESHOLD`, while `derivatives-review.service.ts:54-67` promotes on `verdict === 'approve'` **without consulting `confidenceScore` at all**. That is how four 0.500 artifacts were published. Decide whether approve should hard-block below the bar or warn (editorial override is a legitimate thing to want, and is presumably why the check was never there), and surface the score at the point of approval either way.
- [ ] **Decide whether a wholly ungrounded essay should be written at all.** `_build_provenance_records` still falls back to `sections[0]` — naming a section the artifact never cited — because the NestJS write endpoint rejects an empty `provenanceRecords` (`internal-derivatives.service.ts:214`). Removing the fallback would make such an essay fail the write instead. Arguably correct; a policy change, not a scoring fix, so #319 left it and flagged it in a comment. Score is unaffected either way.
- [ ] **Re-measure whether the other four types also fabricate.** #319 establishes that flashcard/MCQ *store* clean IDs because they filter at write time, not because their models behave. Nobody has measured how many IDs those filters are dropping. If the rate is anything like the essay rate, the same prompt fix (closed list + permission to leave empty) belongs in `flashcard_generation_v1` and `mcq_generation_v1`, and the drop counts are worth logging.
- [ ] **`mcq_question` citations are unmeasurable from persisted rows.** `writeMcqBatch` stores `{questionStem, options, explanation}` only. Measuring them requires either persisting `supportingSectionIds` or reading them back out of `provenance_records` — a change, not a measurement. Blocks any future audit of MCQ grounding.
- [ ] **Reconsider #316's coverage taper after the above.** Closed, not merged; branch `feat/coverage-weight-short-sources` kept. Its 3.4-section geometry finding is sound, but its projection ran over a corpus where 59.2% of essay citation refs were fake, so the numbers in its table describe a corpus that no longer exists.

## Editorial standard for derivative confidence (product decision for brick)

The re-score that led here is **closed — not worth running** (below). What it exposed is a corpus question that outlives it.

**Generations cite ~1 of ~3.4 available sections.** On a 3-section source with `0.5 + coverage*0.5`, the only reachable scores are **0.5 / 0.667 / 0.833 / 1.0**. So the 0.70 bar is operationally "**cite 2 of 3 sections**" — a coarse, near-binary gate wearing the clothes of a graded 0–1 quality signal. An editor reading "0.833" is reading "cited 2 of 3", not a confidence estimate.

- [ ] **Decide what the bar is supposed to mean** on sources this small. Options worth weighing: keep 0.70 and accept it means "cite 2 of 3"; raise the citation requirement in the generation prompts so artifacts ground themselves more densely; score against something other than section coverage on short sources; or set the bar per source size. This is an editorial-standard decision, not a bug — the formula is doing what it says.
- [ ] Related, same root: **`mcq_question` provenance is batch-granular.** One score describes ~5 rows (confirmed 100% on prod: all 14,099 MCQ source documents have `max_distinct = 1` across 70,488 rows). The numbers are legitimate — each batch was scored against its source document exactly as intended — but a row's score is not a statement about that row. Worth deciding whether per-question scoring is wanted before the MCQ corpus grows further.

## Derivative confidence re-score — CLOSED, do not run

- [x] **Not worth running, and there is no corpus operation left to perform.** With `mcq_question` and `subject_outline` refused outright (#315 — neither is row-level reproducible), the dry run moves **7 rows out of 29,471**: 3 `flashcard`, 2 `essay_prompt`, 2 `doctrine_extract`.
- [x] #313 fixed the scorer for everything generated **from now on**, which was the actual problem. The existing corpus barely moves under it.
- [x] **#315 is a safety rail on a script that should sit unused**, not the last step before a run: `--apply` needs the flag, `RESCORE_ALLOW_WRITE=1`, and a passing reproduction check per type. If anyone reaches for this script later, those gates are why it will refuse rather than repeat the 46,081-row near-miss.
- [x] The MCQ open question from Session 209 is answered and closed — see COMPLETED_TASKS.md Session 210.

## Owner / billing (genuinely open)

- [x] **Deploy api with #301** — DONE: api deployed + couponed checkout verified in prod 2026-07-15
- [ ] **#359 `refactor/payment-provider-port`: run the migration against a throwaway DB with `migrate deploy` before merge.** It was never applied — Docker was down locally, so `20260805120000_provider_neutral_billing_columns` is hand-reviewed SQL only. Confirm the three `ALTER INDEX ... RENAME` statements land (Prisma expects `subscriptions_provider_subscription_id_key`, `payment_methods_provider_payment_method_id_key`, `payments_provider_invoice_id_key`) and that the 3 test-mode subscription rows keep their plan ids.
- [ ] **#359 follow-up (needs its own data migration):** the vendor name still appears in persisted strings that this PR would not touch — audit / `Payment.metadata` keys `xenditSessionId`, `xenditSubscriptionId`, `xenditCancelled`; `subscription_history.reason` text; and the admin API response field `xenditInvoiceId`. Neutralising them changes DB writes and an API response, so it is not part of a no-behaviour-change refactor.
- [ ] **Merchant application rejected** — the gateway is not approved anywhere yet. #359 makes the swap cheap; the actual choice (PayMongo / Maya / Dragonpay) is still open and blocks every item below it.
- [ ] **Xendit go-live key swap** — deactivate the TEST plan FIRST, then swap env to live keys
- [ ] **2026-08-10: verify the first anchor-date recurring charge** collects correctly (first cycle after the anchor-date fix)
- [ ] **Annual interval check** — run one YEAR-interval checkout in sandbox; Xendit sessions doc lists interval DAY|WEEK|MONTH — if `YEAR` 400s, switch annual to `MONTH` × `interval_count: 12`
- [ ] **Activate Cards** as a payment channel
- [ ] **Edu-plan billing launch** — blocked on Xendit sandbox setup
- [ ] Xendit webhook end-to-end test with test payment methods; confirm Nginx webhook route in prod (Session 191 leftover)
- [ ] #326 deployed the `teamCollaboration` gate on `POST /organizations/:id/members/invite` (Team tier or higher). The internal LIBERTASIAN org `00000000-0000-0000-0000-000000000001` has NO subscription row, so `getPlanCode` resolves it to `free` and it can no longer send invites. Fix is a one-row `subscriptions` insert attaching the `team` plan to that org, or an `entitlement_overrides` admin_override on `teamCollaboration`. Prod-side task — brick/prod Claude, not local.
- [ ] Same gate: `Bri Agcopra's Workspace` (2 members, no subscription) is in the same state. Decide whether it needs a plan or stays free.

## Mobile (next EAS build / store readiness)

- [ ] **Next EAS build / OTA must carry** (all JS-only): #289 annotations + highlights, #290 bookmark upgrade-alert copy, #297 anchor-offset fix + multi-annotation view sheet, #302 coupon input + Home search entry + Digests repair + Digests TabBar — no server deploy moves these. #302's api dependency is satisfied: the #301 api deploy went live 2026-07-15, so the Digests list params no longer 400. **Add #355** (pill nav on all eight tabs) and **#354's mobile half** (Digests tab querying the real search corpus — but that one is inert until the prod index rebuild runs)
- [ ] **brick: device smoke of TestFlight build 8** — Google + Apple sign-in end-to-end (new user → onboarding, existing → tabs), cancel silent on both, Apple button absent on Android
- [ ] **Play Store first upload (manual)** — Android .aab from EAS build `4d20323a` (versionCode 3) + store metadata + reviewer account before App Review; service-account submit path stays unused until the first manual upload
- [ ] Store assets: replace placeholder `assets/icon.png` / `adaptive-icon.png` / `splash-icon.png` with branded assets; add `google-services.json` for Play submission
- [ ] iOS spot-check of #285 stack headers — chevron style (`chevron-back` fallback) + swipe-back within groups on simulator/TestFlight
- [ ] Mobile visual QA batch (#281/#284 rollouts): theme A (orange accent) ambient + owl contrast, reduce-motion → blobs AND owl static, DocumentReaderScreen ambient beneath zIndex 5 gradient + zIndex 10 header; native #285 headers are static Theme A cream — check acceptability under Theme B

## Web visual QA (post-deploy eyeball batch — #280/#282/#283 merged, no tooling)

- [ ] Home header owl position (moved right:5% → left:34%, tuned at 1440px) at common widths; dashboard h-14 `bar` variant live (only verified on an isolated preview page); glass ambient plainly visible on `/`, `/login`, dashboard; reduce-motion → everything static; owl still static on hero/signup illustrations
- [ ] Receipt email (#277 merged + deployed): send a sandbox receipt and eyeball in Gmail (web + mobile app) and at least one Outlook client — table layout, dark header band, PAID pill, button

## Staging re-enable prerequisites (#295 made deploys dispatch-only)

- [ ] Provision staging VPS (Docker + Compose, repo at `/opt/libertasian`, `DATABASE_URL` in host env)
- [ ] Set `STAGING_HOST` / `STAGING_USER` / `STAGING_SSH_KEY` (+ optional `STAGING_SSH_PORT`) on the GitHub `staging` environment (currently has ZERO secrets)
- [ ] Author the missing `docker-compose.staging.yml` the deploy script references (absent from repo — latent blocker)
- [ ] Then restore the `push: branches: [main]` trigger in `.github/workflows/deploy-staging.yml` (original trigger preserved in a comment)

## Search overhaul (Phases A–C3 merged, deployed and live-verified; client UI + C4 remain)

Ground truth below is from brick's Phase A production dry-run (2026-07-25) — measured on prod, not assumed.

**Shipped / verified**
- [x] Phase A (#306, `7166214`) — explicit mappings behind versioned aliases. Prod run: 17,135 docs → 85,977 entries in 3m24s. Filters confirmed live on `_v2`: `document_type=decision` 76,484 · `ponente=LOPEZ` 301 · `status=published` 29,166 · `gr_no_digits=246999` 4 · `ponente.text` match `hernando` 622 · `estafa` no-fuzzy 1,987 (was 4,040). Vector index repaired: `knn_vector` dim 384 HNSW, `index.knn` true, all 12,196 embeddings copied. Synonym rules parse against a real cluster — that risk is closed.
- [x] Phase B (#307, squashed to `27538fd`) — query intent classification + tiered ranking.

- [x] Phase C0 (#308, `b2d1da1`) — measured index-copy verification + `court_key` filter field.
- [x] Phase C1 (#310, `3e06e64`) — pure `extractSearchableText` for all 11 `content_json` shapes + the `dynamic: 'strict'` derivatives mapping (BM25 only, no `knn_vector`, no field able to hold an MCQ answer key). The 11 shapes moved to `@libertasian/types`; web vitest now aliases that package to source.
- [x] Phase C2 (#311, `d4077df`) — derivatives phase in the rebuild job (keyset, soft-delete-excluded, `_bulk` 500, per-item failures THROW) + `buildDerivativeVisibilityFilter` with `organization_id` **omitted** (never `''`) for null-org rows.
- [x] Phase C3 (#312, squashed to `025e538`) — federated `POST /search` with `scope=documents|derivatives|all`; visibility filter is a required non-optional argument; derivative results uncached (org-dependent key); kinds concatenated, not globally ranked; highlight fields named explicitly + `sanitizeDerivativeSource`; derivative-arm failure degrades to document results + warning; `describeTopology` `_r<N>` false-mismatch fixed.
- [x] **Phase C3 deployed and live-verified on prod (2026-07-26)** — api rebuilt and recreated from `025e538`; all four scope cases exercised against `POST /api/v1/search` with a minted RS256 JWT. Numbers in COMPLETED_TASKS.md Session 208.
- [x] **Both prod index rebuilds verified (2026-07-26)** — job 3, four indices: docs 17,135/17,135 → 85,977 sections, `vectorsCopied: 12196`, uploads 2, derivatives 99,994/99,994, `aliasSwapped: true`, `aliasesSkipped: []`, `court_key=supreme_court` exactly 7,443.

**What is actually reachable — read this before scoping Phase D**

Deploying the federated surface did **not** make ~100k derivatives reachable. Only the **13,017** `public_editorial` rows match a visibility branch. The other **86,977** are `visibility='private'` with `organization_id` NULL, so they match **neither** branch of `buildDerivativeVisibilityFilter` — not the public branch (wrong visibility) and not the org branch (no org to own them). They are indexed and invisible to every caller, which is the filter working as designed, not a bug to fix.

- [ ] **Question for brick: are those 86,977 private null-org rows a generation-pipeline gap or intended drafts?** This is a product decision, not an engineering task. If the generator was supposed to mark them `public_editorial` on approval, that is a pipeline defect and search recall is ~13% of what anyone assumes. If they are deliberate drafts, the corpus is correct and only the expectation needs fixing. Nothing downstream should be scoped until this is answered.

**Phase C — remaining**
- [ ] **No client sends `scope`** — web and mobile search UIs still query documents only. Federated results need a UI decision (separate "Study materials" section vs a filter chip) before they reach users. Kind labels and counts are already in the response `meta`.
- [ ] **`limit` is per corpus, not per response.** `federatedSearch` applies it to each arm, so `scope=all&limit=10` returns **20** items — 10 documents then 10 derivatives. Intentional: two concatenated BM25 lists cannot share one limit without one corpus silently starving the other. Phase D UI must render two sections from `meta.counts` and must **not** assume `items.length <= limit` — a client that slices to `limit` would drop the entire derivative section.
- [ ] **`content_plain_text` is still dead weight.** It is written from the create/update DTO and `null` in every generation path; C1's extractor is used only by the indexer. Persist the extraction on write, then backfill — real backfill size is **13,017 rows** (`public_editorial` + `approved`), not 99,994.
- [ ] **E2E cross-tenant tests must seed synthetic org-scoped rows.** `organization_id` is NULL on 100% of prod derivative rows, so no production data exercises the org branch. C2/C3 unit specs evaluate the DSL against synthetic documents; a real seeded E2E pass is still owed.
- [ ] **C4 — cross-corpus fusion.** The two result lists are concatenated because BM25 scores from indices with different mappings and term statistics are not comparable. Globally ranking them needs a reranker over the merged set → blocked on the same `RAG_RERANKER_URL` deployment as the kNN/cross-encoder work below.
- [ ] Digests + `bar_exam_questions` federation: scope unchanged from the original plan, not started.

## Parked PRs (decide: revive or close — all verified OPEN 2026-07-13; nothing closed)

- [ ] #2 chore(ingestion): align seed defaults with Option A tiered schedule
- [ ] #39 chore(infra): document Brevo as SMTP provider
- [ ] #99 feat(admin): pipeline-ops trigger page + digests list with status tabs
- [ ] #117 feat(mobile): design system Phase 1 — two-theme tokens, 14 primitives, 9 screen components
- [ ] #236 chore(api): Polly voice-spike script

## Planned work (not started)

- [ ] **Session 203 — Mobile Design System Phase 2**: wire the 9 presentational screens into real routes (onboarding, login, signup, home, library, reader, digest detail, search-as-own-tab, profile). TabBar IA decision pending — **question for brick:** 7 existing tabs vs design's 4 (Read/Library/Search/Me): drawer items or deep-link-only for the other 5? Open design questions: drop-cap approach on Android, expo-blur for reader top buttons. Phase 3+: BottomSheet primitive (gesture-handler recipe in memory), dark-mode variants, real images. Verification: EAS preview APK + max 2 visual iteration rounds. (Foundations shipped as PR #117 — parked above.)

## Backlog (genuine follow-ups, no deadline)

- [ ] Adopt `emailLayout()` shell in the other 11 notification templates (verify-email, reset-password, password-changed, member-invite, subscription-confirmation, subscription-cancelled, payment-failed, renewal-reminder, budget-alert, announcement, blog-notification) — #277 follow-up
- [ ] Resend-verification rate limiting (max 3 / 15 min per email, Redis) — currently global throttle only; backfill `EmailPreference` rows for existing users (Session 186)
- [ ] Spec-file TS error cleanup (Session 184): coupon (~539), promotion (~384), promotion-rule-engine (~209), research-workspaces (~152), pleadings (~129), ~35 other spec files (~987)
- [ ] Mobile `tsc --noEmit` React 19 @types cleanup (37 errors on main: Stack/Tabs/LinearGradient/Svg)
- [ ] Congress.gov.ph Cloudflare Turnstile: pick approach — (a) Playwright/headless, (b) ingest RAs via Official Gazette, (c) direct `docs.congress.hrep.online/legisdocs/ra_{congress}/RA{number}.pdf` URLs (Session 193)
- [ ] Enhancement wishlist (Sessions 200/202, deduped): document browser view toggle + sort options; search cards aware of existing digests ("View" vs "Generate"); stale-data indicator on digest detail; digest list infinite scroll; verify `@react-native-picker/picker` installed for classification override; admin derivatives real-time job status; study stats weekly sparkline; `codal_section` resource navigation; MCQ keyboard navigation; offline syllabus cache (SQLite)

## Needs verification (could NOT be verified against ground truth today — do not treat as done, do not treat as fact)

- [ ] #286 `apple_id` migration (`20260711120000_add_user_apple_id`): has `prisma migrate deploy` run in prod/staging? Also: local dev DB drift (applied migration `20260505013309` missing from directory) — reset vs reconcile still undecided
- [ ] #254 (2026-07-02): staging/dev `prisma migrate deploy` for the allowlist migration + RBAC Redis cache flush where warm; #250–#253 live verifications (admin sidebar/settings gating on prod; #250's revocation itself WAS live-verified 2026-07-02)
- [ ] #276 checkout-flow device QA (bounce → deep-link return, AppState safety net, both themes) — may have been implicitly covered by later live billing verification
- [ ] Session 193 ingestion: worker-service image rebuilt since the autodiscover fix? prod source endpoint URLs re-seeded (`seed-sources.ts`)? fetchers spot-tested?
- [ ] Sessions 185/186 Prisma migrations applied in prod (`add_email_preferences`, site-content)? end-to-end tests of verify-email OTP / preferences / announcements / homepage CMS
- [ ] Session 191: lifecycle processor e2e (create event with past `scheduledAt`, verify cron transitions)

## Blocked — requires external resources (unchanged)

| Item | Blocker |
|---|---|
| Embedding service kNN + cross-encoder reranker | Deploy models + set `RAG_EMBEDDING_SERVICE_URL` / `RAG_RERANKER_URL` (BM25-only + RRF fallback active) |
| Production VPS deployment | VPS provisioning (compose/nginx/monitoring/backup/GH Actions all ready) |
| OpenSearch index creation | Running OpenSearch instance (auto-creates on module init) |
| Qdrant migration / multi-region / white-label | Scale, budget, enterprise demand (Phase 5+) |

Deferred PRD decisions (Section 16): bilingual/Taglish queries (P2), on-device OCR preview, public API marketplace, AI pleading templates (legal risk).

## Known issues / workarounds (non-blocking)

- React 18/19 type conflict (mobile 18 / web 19): `typescript.ignoreBuildErrors` in next.config.ts; tsc runs separately in CI
- OneDrive path casing on Windows: `force-dynamic` root layout workaround; cosmetic webpack warnings remain
- Local gradle debug builds: expo-av CMake fails on arm64 (`build.ninja still dirty`); use `-PreactNativeArchitectures=x86_64` for emulator builds
