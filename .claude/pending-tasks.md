# Pending Tasks

## App stores (checked 2026-11-20)
- [x] App Review UGC (1.2) + AI-data (5.1.2(i)) gaps FIXED in PR #544 (merged 8a8d042b, deployed to prod 2026-11-20: migration `20261120120000_add_feed_comment_reports` applied, api+web rebuilt and healthy).
- [x] Moderation queue BUILT (branch feature/moderation-queue): web `/admin/moderation` (Queue | Sanctions | Log + case detail), API `/admin/moderation/*`, auto-hide at 3 reports, moderator emails (new case + 09:00 Manila daily summary), community sanctions (warn / suspend 1-30d / ban). Also closed the hole where every workspace owner held `community:moderate` (migration 20261121130000).
- [ ] Moderation follow-ups (nice-to-have): reporter-accuracy weighting; keyboard shortcuts (j/k, d/r) in the queue; `/admin` shell admits `isPlatformAdmin` only, so a pure `community:moderate` grant (no admin:*) can't open the page (admin + editor roles are fine today); community flags have no per-user uniqueness (the 20/day cap now bounds it). Appeals reach users only from app builds that include Settings › Community standing (next build after 1.0.3 b35); older builds get the notice text but tapping it routes nowhere.
- [ ] Small leftovers: the Report button shows on your own community items; ratings/reviews are not displayed anywhere, so `community_rating` flags are unused; `NSPhotoLibraryAddUsageDescription` is unused (app.json); the search AI summary has no disclaimer.
- [ ] Prod `npx prisma` inside the api container pulls a newer Prisma major ("Use the replacement: prisma db migrate") and applies NOTHING. Use `node node_modules/.pnpm/prisma@6.19.2_typescript@5.9.3/node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma`. deploy-production.yml line 181 has the same bug.
- [x] Play: production access GRANTED 2026-11-21 (email received; re-applied 2026-11-20).
- [ ] Play production release: nothing is live on production yet. Smoke-test 1.0.3 vC18 (SDK 58) from the alpha track on a device (sign-in, audio, purchase), then Play Console → Test and release → Production → create release from vC18 (or promote from Alpha), fill "What's new", staged rollout (e.g. 20%), send for review. `releaseStatus` is ALREADY `completed` in eas.json (flipped 2026-08-18); only `track` is still `alpha` — decide whether future `eas submit` targets production or keeps going through alpha + promote.
- [x] eas.json `submit.production.android.track` switched alpha -> production (2026-11-21, PR #548). `eas submit` now sends Android straight to production review; use `--profile internal` for device tests.
- [ ] (step 3 DONE: PR #548, API deployed) Android has NO purchase/subscription option (user-confirmed on vC18 2026-11-21). Cause: no `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` in the eas.json production build env, on purpose, because Play has zero subscription products (needs a payments profile). Fix: (1) create Play subscriptions com.libertasian.pro.monthly/.annual + edu.monthly/.annual with base plans and PH prices; (2) import them into RevenueCat, attach to the same entitlements/offering as iOS; (3) CODE: RevenueCat reports Play subs as `subscriptionId:basePlanId`, but `isStoreProductId` in apps/mobile/src/features/purchase/products.ts matches the exact iOS ids, so every Play product would be dropped; check the API webhook product mapping as well; (4) add the Android key `goog_VjSuppDTBPHUMUULFkfgFSdkoxL` to the build env, rebuild, test with license testers.
  - [x] Code fix 2026-11-21 (PR #548 merged 3c5be6f0, API deployed): mobile `toStoreProductId` (products.ts, used in use-offerings.ts) + API `resolveStoreProduct` accept `<subId>:<basePlanId>` only when basePlanId == billing period; RevenueCat pull rejoins `product_plan_identifier`. Mobile purchase 113/113 (incl. new cases), API store-purchases 208/208, tsc clean both apps. Decision: release waits for Android purchases.
  - [x] Play Console 2026-11-21: 4 subscriptions created + ACTIVE, each with one auto-renewing base plan `monthly`/`annual`, all 178 countries, no offers/trials (iOS has none). PH prices: Pro ₱2,000 / ₱20,000, Edu ₱500 / ₱5,000 (user chose round-up: Play charms PH to ₱50 steps after 12% VAT, so iOS ₱1,990/19,990/499/4,990 can't be matched). Abroad derived from the PH pre-VAT base (US: $27.99 / $279.99 / $6.99 / $69.99). Grace 7d monthly / 14d annual (Play defaults). Optional: subscription benefits text not filled.
  - [x] RevenueCat import + entitlements + offering, Android key in eas.json, vC19 on the internal track, prod STORE_PURCHASE_AVAILABLE_ANDROID=true (2026-11-21).
  - [x] Device test passed on vC19 (purchase completed 2026-11-21).
  - [ ] vC21 SENT TO GOOGLE REVIEW for PRODUCTION (2026-11-22): user verified on device; promoted internal -> production in Play Console (eas submit fails: "version code already uploaded"), countries = Philippines + United States (same as iOS; also applies to Open testing, which shares targeting), "What's new" added, hardware-features warning (screen.portrait, wifi) ignored. Managed publishing OFF -> goes live automatically once approved (usually <= 7 days). Follow-up: check Publishing overview / email for approval or rejection.
  - [ ] iOS: the live 1.0.3 lacks #550 (post-purchase confirmation) and #552 (manage/cancel). Needs a new iOS build + App Review; bump marketing version past 1.0.3 (approved) per eas_remote_versioning memory.
- [ ] iOS 1.0.3 build 38 (Expo SDK 58, Xcode 27.2) SUBMITTED FOR REVIEW 2026-11-21 9:48 AM — 'Waiting for Review'. PR #547 merged (d29999fb). Watch for the App Review result email (up to 48h). Android 1.0.3 vC18 (SDK 58, compileSdk 37) built and SUBMITTED to Play alpha track as completed release (EAS submission 202c9c8d, FINISHED); vC17 failed on compileSdk 36. Not device-smoke-tested before submit (user's call): if review or users report audio/sign-in/purchase issues, start there.
- [ ] Apple: Account Holder must accept the updated Apple Developer Program License Agreement (blocks app updates/new submissions).
- [ ] Apple App Compliance: China mainland REMOVED from availability 2026-11-20 (96 → 95 regions; Apple said it takes effect within 24h). Re-check the App Compliance page after 2026-11-21: the Security Assessment + AIGC "Missing Info" rows should clear. If they persist, they only apply to China mainland distribution, so they are not blocking.
- [x] Apple age rating answered 2026-11-20 (Shared Location No, Dating No; UGC + Social Media corrected to Yes because the Feed has posts/comments). 18+ override kept.

## OpenAI gpt-4o-mini retirement — DEADLINE 2027-01-14 (evaluated 2026-11-19)
- [x] Evaluated gpt-6-luna on prod 2026-11-19 (temp container, golden set + dry-run replay of 6 worker job types; results in prod `services/rag-service/evals/results/20261119-*.json`).
- [x] Prompt fixes both models need (#540, merged + deployed 2026-11-19): classification prompt now names the `assignments` schema (luna failed 4/4 → 12/12); answer prompt v1.5 makes a whole-answer "passages don't address it" refusal emit INSUFFICIENT_SOURCES (luna must-abstain recall 1/5 → 3/5; remaining 2 are honest partial answers).
- Findings: /answer on luna is faster (p50 12.3s vs 13.7s), hit@k +0.025, citation validity 100%, fewer citations per answer (2.8 vs 3.5). Classification: luna primary differed on 4/12 docs and luna was right on all 4 (procedural cases → remedial_law, search-warrant case → political_law); mini almost never assigns secondaries. Essay: luna abstained on 2/4 (passages lacked the court's reasoning). MCQ/flashcard/doctrine/digest: 4/4 pass on both.
- Cost: luna output tokens 1.3–1.5x for most jobs, 2.4x for ingestion digests. Projected over the 90-day job mix ≈ $127 vs $133 on mini (digests +23%, others cheaper). Latency on bulk jobs +10–60%.
- [x] Switched 2026-11-19: prod `.env` RAG_OPENAI_MODEL=gpt-6-luna (backup `.env.bak-20261119-pre-luna`), rag-service recreated, smoke completion returned model_name gpt-6-luna. Repo defaults (`config.py`, `.env.example`, `seed.ts`) aligned. No test asserted the default. Rollback: restore that line + `docker compose -f docker-compose.prod.yml up -d --no-deps rag-service`.
- [ ] Watch model_runs + essay abstain rate + budget through 2026-11-27. Prod cron (23:55 UTC, self-stops after 11-27) writes `~/luna-watch/<date>.txt` on libertasian-prod via `~/luna-watch/luna-watch.sh`. Read with `ssh libertasian-prod 'cat ~/luna-watch/*.txt'`. CAVEAT: prod has had NO organic generation since 11-04 (newest legal_document 2026-11-04 although crawls complete 50 jobs/day; classification sweep finished 11-12; zero LLM spend 11-13..11-18), so the week may show nothing. Baseline: mini essay abstain 15/35,767 (0.04%).
- [ ] Essay abstain on luna is 8/60 (13.3%) in a dry-run replay over docs mini had completed (2026-11-19, `/tmp/essay60.json` in worker-service). All 8 reasons say the source is truncated before the court's reasoning, and they are right: `build_sections_text` cuts every section at MAX_SECTION_WORDS=800 (essay, mcq, flashcard, subject_outline), and 96.2% of the 35,503 essay source docs have a section over 800 words (the 8 abstained docs have 1,958-9,875-word sections). So mini wrote most essays from the first 800 words. Decide: raise/replace the cap (token cost) or select the reasoning section instead of the head. Measure on live rows before changing.
- [ ] Why have daily crawls created no legal_documents since 2026-11-04? (ingestion_jobs 50/day all `completed`.)
- [x] Deep-research planner/verifier → gpt-6-luna with reasoning_effort="none" (branch fix/deep-research-planner-verifier-luna). Every non-reasoning OpenAI chat model (4o, 4o-mini, 4.1, 4.1-mini) also shuts down 2027-01-14, so no non-reasoning successor exists. Shadow eval on prod 2026-11-19 (45 golden questions, same inputs to both): 0 reasoning tokens, 0 empty/length replies, JSON 45/45 + 39/39; planner scope agrees 44/45 (the 1 diff: mini wrongly refused answerable tax-05); verifier is stricter (rerun: 5/149 claims mini-supported → luna-unsupported, 4 of 5 correctly catch details absent from the evidence); ~20% cheaper, +0.5s p50 per call. Rollback until 2027-01-14: DEEP_RESEARCH_{PLANNER,VERIFIER}_MODEL=gpt-4o-mini.
- [ ] Optional: Batch/Flex (50% off) for backfill-scale jobs; consider luna only for digests if cost matters.

## Corpus crawler health (checked 2026-11-19)
- [ ] Official Gazette crawler gets 403 (bot-blocked) on every run; Congress gets a Cloudflare managed challenge (403). Neither has EVER returned a candidate, yet jobs report `completed, errors=0`. Decide: headless browser / official API / alternate source (e.g. senate.gov.ph, elibrary statutes), or disable the endpoints.
- [ ] Make a 403/Cloudflare block count as a job error (errors_json), and alert when a source finds 0 records for N days, so silent failures surface.
- [ ] Lawphil runs HOURLY and re-reads the same 87 candidates (found=87 created=0); once or twice a day is enough and is politer to lawphil.
- [ ] RAG /answer end-to-end took 32s on prod (gpt-4o-mini, 8 passages). Profile where the time goes (retrieval vs rerank vs LLM).

## Deep Research device-test builds (2026-09-30, PRs #533 + #534, NOT merged)
- [ ] Review/merge #533 (`submit.internal` profile: Android track internal; production stays alpha/completed).
- [ ] Review/merge #534 (version 1.0.3). iOS build 34 was built from this branch, so main lags the shipped version until it merges.
- [ ] Android 1.0.2 (vC15) is on internal only. The next alpha/production build must be versionCode >= 16 and should carry 1.0.3.

## Section chunks for search (2026-09-29, PR1 #528 + PR2, NOT merged)
- [ ] Review/merge PR1 (`fix/rag-collapse-chunks`) BEFORE PR2 deploys: without it, chunk hits of one section fill several top_k slots.
- [ ] Review/merge PR2 (`feat/api-section-chunks`). Migration `20260929120000_vector_backfill_prune_stale` adds `vector_backfill_runs.prune_stale`.
- [ ] After PR2 deploys: confirm the api boot log shows no "Could not add chunk fields" error (ensureIndexes adds `chunk_index`/`char_start`/`char_end` to the live aliased indices; both mappings are strict).
- [ ] Recreate opensearch with the new limits (memory 6G, heap 2g) before the backfill; vectors grow ~159K -> ~680K.
- [ ] Rebuild (`POST /search/index/rebuild`): keyword rebuilt chunked from Postgres, vector copied. Old physical indices are kept; delete them only after the new ones are verified in use.
- [ ] Backfill: `docker compose -f docker-compose.prod.yml --profile backfill up -d embedding-backfill`, then a `pruneStale: true` run (dry run first for the chunk count; ~602K expected). Stop embedding-backfill when done.
- [ ] Out of scope, found while scoping: dispositive sections are mis-segmented (section segmentation untouched by this epic).
- [ ] Out of scope: `SearchService.bulkIndexDocuments` (`POST /search/index/bulk`) writes document rows with no `plain_text`, wiping their bodies in the keyword index.
- [ ] Out of scope: unpublishing a document leaves `is_published: true` on its keyword/vector rows (the index is not updated).

## Statute corpus repair follow-ups (2026-09-27, PRs #516–#518, NOT merged)
- [ ] Review/merge #516 (async `_reindex` copy with a deadline; backfill batch default 32). New env var `SEARCH_INDEX_COPY_TIMEOUT_MIN` (default 60).
- [ ] Review/merge #517 (`reseed_statutory_document`). Then on prod, between 1 and 6 PM ET, run the dry-run command from the PR body for Evidence, Special Proceedings, Admin Code, NIRC and the 1987 Constitution. Review any `needs_decision` rows and `sections.csv`, then `--commit`.
- [ ] After a re-seed commit: re-embed the changed sections and re-index their OpenSearch chunks (the task does neither).
- [ ] Review/merge #518 (stale audio → 202 + regen on play). Adds one section read + SSML build per ready GET.
- [ ] Parser gap: Rule 72 §1's text is dropped. `Section 1.</b>` has no opening `<b>`, and the text sits before the first recognised marker.
- [ ] Parser gap: unbolded `RULE 128` / `RULE 72` headings (plain `<p>RULE N</p>`) are not section boundaries, so those rule headings get no row.
- [ ] `POST /search/index/bulk` has no DTO (request body not validated).

## Follow-ups after #514 and the codal realign (2026-09-27)
- [ ] POST /search/index/bulk accepts an unvalidated body; needs a class-validator DTO (found in #514 review).
- [ ] Re-seed needed: RoC Evidence, RoC Special Proceedings, Administrative Code 1987, NIRC (skipped by realign, still off by one); 1987 Constitution has doubled paragraphs in 35 rows plus a repeated Art III Sec 3–12 block; 10 first rows empty after realign; Rule 135 Section 1 holds Section 2 text.
- [ ] 5,630 reader audio clips voice pre-realign text (list: prod /home/brick/realign-2026-09-27/commit/audio_renditions.csv); regeneration is a cost decision.

## Deep Research quote matching (2026-09-28, fix/deep-research-quote-matching, PR open)
- [ ] After merge + deploy: re-run the gate5 eval and compare against 16/40 `validation_failed` (quote_not_found 31, quote_length 12, verifier_unsupported 6).
- [ ] `test_routers.py` has 40 errors on main (sync tests request the async `client` fixture, so pytest raises PytestRemovedIn9Warning). This PR did not cause them.

## Deep Research client follow-ups (2026-09-27, after #508 / #509 merged)
- [ ] Review/merge PR #513 (mobile reader pinpoint + login redirect keeps `?q=`, incl. Google OAuth via sessionStorage). One web test (`reader/[id]/page.test.tsx`) timed out under full-suite load; it passes on its own.
- [ ] Web UpgradeBanner → "subscribe in the iOS app" CTA (decided 09-20) before `PAYWALL_ENFORCED_WEB` is set. Applies to Deep Research and Memos. It never shows today: the flag is unset in prod, so every web user counts as pro.
- [ ] 16 pre-existing e2e failures in `subscription-enforcement` + `entitlement-enforcement-gaps`.
- [ ] Duplicate `@types/react` (tsc reports 397 errors on main).

## RAG statute retrieval (2026-09-27, PR #511, NOT merged)
- [ ] Review/merge #511: stopwords removed + citation_text dropped from non-CASE_LOOKUP BM25; statutory doc-level rows excluded; `deep_research_max_per_statute=6`; article/section pinpoint fetch.
- [ ] Verify on prod that the pinpoint lookup finds sections (it assumes labels "Article N." / "Section M."; Rules of Court relies on a "RULE N" heading or a per-rule document).
- [ ] Pre-existing: 40 pytest-asyncio errors in rag `tests/test_routers.py`; 19 `mypy --strict` errors; ruff I001 in `tests/test_retrieval.py`.

## Codal off-by-one repair (2026-09-27, PR #512, NOT merged)
- first_label_missing deviation ACCEPTED by prod review 09-27 (12/24 statute docs lack first label; strict rule would skip half). Realign dry-run + commit + re-embed/reindex are prod-side, not done yet.
- [ ] **Decide:** the first row of each doc is exempt from "skip if label missing" (flagged `first_label_missing`), because the old parser lost each doc's opening paragraph. Accept, or make it strict.
- [ ] After merge: run the dry run on prod, review `sections.csv` (a cross-reference whose text matches the next label can mis-split a row), then `--commit`.
- [ ] After commit: re-embed the changed sections and re-index their OpenSearch chunks; review `audio_renditions.csv`; re-seed to recover each doc's lost first paragraph.
- [ ] Repaired rows keep the "Article N." prefix in their text; freshly seeded rows strip it. Decide whether to normalise.

## Deep Research (2026-09-26, feature/PHASE-1-deep-research-api, PR open, NOT merged)
- [ ] **Acceptance gate before shipping:** run `python -m evals.run --endpoint deep` on prod (45-question golden set) and compare it against the /answer result file with `python -m evals.compare ... --k 8`. It ships only if authority_hit@8 > 0.525, citation_validity = 1.0, and no must-abstain question is answered.
  - **Gate run 2026-09-28 (prod, `--concurrency 1`): FAILED.** authority_hit@8 0.550 (vs /answer 0.475, passes), citation_validity 1.0 (passes), answer_rate 0.650, p50 25 s. Must-abstain answered **3/5** (fails): abs-01 (US Heller case) and abs-02 (German BGB) hit the 20 s reranker timeout and were answered from RRF order; abs-04 (PH tax rates for 2040) was answered. /answer abstained on all three. The 40-passage rerank overran 20 s on 11 of 45 questions.
  - [ ] Review/merge the `fix/deep-research-abstention` PR (fail closed on a degraded rerank → `ranking_unavailable`; planner scope check → `out_of_scope`; `deep_research_max_candidates` 40 → 30; `deep_research_rerank_timeout` 30 s). Then deploy rag-service and re-run the gate. Watch: must-abstain 0/5 answered, authority_hit@8 still > 0.525 at 30 candidates, and the in-scope questions the planner now refuses (should be none).
  - [ ] Review/merge the `fix/deep-research-removal-reasons` PR, then on the gate re-run read `removal_reasons` per question to see which verification step drops claims.
  - [ ] Mobile Deep Research `AbstainedCard` still has one fixed title ("No verified answer") for every reason; the web card's tips list (name the law, use PH terms) also still shows for `ranking_unavailable` and `out_of_scope`.
  - [ ] A deployment without a reranker (`RAG_RERANKER_URL` unset) now abstains on EVERY Deep Research question. Prod has one; check staging/dev before demoing there.
- [ ] Deploy the `20260926120000_add_deep_research_runs` migration. Set `DEEP_RESEARCH_*` env on rag-service if the defaults change, and set `DEEP_RESEARCH_MODEL_ALLOWLIST` to allow `gpt-6-luna`.
- [ ] Optional: set an `ai_research` per-scope budget cap (`llm:config:monthly_budget_usd:ai_research`).
- [ ] Web and mobile clients are built in parallel against the SSE contract. Refusals on `POST /deep-research/stream`: 402 `subscription_required` for free accounts, 429 `quota_exceeded` when the quota is spent. Branch on `code`.
- [ ] Pre-existing e2e drift: `subscription-enforcement` and `entitlement-enforcement-gaps` still expect tier names in the 403 message.

## Follow-ups from the OpenAI quota outage fix (2026-09-26, fix/rag-openai-quota-503)
- [ ] **Pre-existing 422 bug:** `/memos/generate` and `/comparisons/generate` reject every JSON request. Their `strict=True` request models refuse the string values of `memo_type` / `comparison_type` ("Input should be an instance of MemoType"). NestJS sends exactly those strings (`memos.processor.ts:100`, `case-comparisons.processor.ts:121`). Confirm against prod logs, then add `Field(strict=False)` on the enum fields or drop strict mode on those two models.
- [ ] Documents whose doctrine, digest or classification step was skipped with `provider_quota_exhausted` stay unprocessed. Nothing re-selects them automatically, so check the classification and digest backfills cover them.
- [ ] `_check_budget` in rag-service `core/generation.py` still fails CLOSED on a Redis outage (500), while the new quota breaker fails open. Decide whether budgets should fail open too.
- [ ] `chain_post_ingestion` from daily-crawl still fans out LLM tasks during an outage. Each one now costs a cheap 503 with no retry and no OpenAI call. Gate it on `rag_client.provider_quota_exhausted()` if that noise matters.
- [ ] Add alerting on the `llm_provider_quota_exhausted` ERROR log (one per 300s breaker trip).

## Before Merging (from OpenAI API Integration)
- [ ] Run `pnpm --filter api prisma:migrate:dev --name add_ai_settings` to create the actual migration
- [ ] Run `pnpm --filter api prisma db seed` to seed AI settings defaults
- [ ] Add `admin:ai-settings` permission to RBAC seed data (or use existing admin permissions)
- [ ] Test with actual OpenAI API key: set `RAG_OPENAI_API_KEY` in `.env`

## Pre-Existing Issues
- [ ] Fix eslint PATH issue in @libertasian/types package (eslint not recognized)
- [ ] Fix 30 failing tests in analytics-aggregation.service.spec.ts (TypeError: prisma undefined, computeScanToDigestFunnel)

## Future Enhancements (Not in Scope)
- [ ] Add RAG service fire-and-forget call to POST /internal/model-runs after each generation
- [ ] Add rate limit configuration UI in admin panel (currently only ingestion rate limits are seeded)
- [ ] Add usage export/download feature for finance reporting
- [ ] Add per-feature budget allocation (separate budgets for digests vs answers vs memos)
- [ ] Migrate auth token storage from localStorage to httpOnly cookies (deferred from security audit)

  - [ ] iOS 1.0.4 (build 39, EAS eceb05e9, PR #553) SUBMITTED FOR APP REVIEW 2026-11-22 7:29 AM ("Waiting for Review"); carries #550 + #552; "Automatically release this version" is on, so it goes live on approval (Apple says up to 48h). Follow-up: watch for the Apple email; on rejection, read the resolution center.

## Device limits (decided 2026-11-22; research summary in conversation: Jur.ph 3 devices, Chegg 2, Netflix 2-4 streams, Spotify 1 stream)
Policy: Pro = 3 signed-in devices / 2 in use at once; Edu = 2 devices / 1 in use at once; free = no cap. LRU device signed out on a new sign-in over the cap; no swap limit; account = one person, no credential sharing.
  - [x] PHASE 1 DONE + DEPLOYED 2026-11-22 (PR #555, prod DEVICE_LIMITS_ENABLED=true, .env backup .env.bak-20261122-device-limits; migration 20261122130000 applied): X-Device-Id/X-Device-Name headers (web + mobile api clients), refresh_tokens.device_id/device_name migration, enforcement on new sign-in (same-device revoke + LRU eviction by tier), fail-open, env DEVICE_LIMITS_ENABLED / DEVICE_LIMIT_PRO=3 / DEVICE_LIMIT_EDU=2, `sid` claim, sessions list returns deviceName/lastUsedAt/isCurrent, ToS clause (web + mobile terms), LoginEvent+audit `session_evicted`. Deploy API+web, set DEVICE_LIMITS_ENABLED=true in prod .env; mobile header ships in next builds (old builds fall back to fingerprint-only).
  - [x] PHASE 2a: concurrent-use cap CODED + tested on branch feature/device-limits-phase-2-concurrency (see completed-tasks 2026-11-22). NOT committed/pushed.
  - [ ] PHASE 2a ship: commit + PR + merge, deploy API + web with DEVICE_CONCURRENCY_ENABLED=false, then flip to true in prod .env (back it up) and watch `session_displaced` / `session_concurrency ... failed open` in API logs. Mobile sheet ships with the next app build; until then old builds get a generic error on 409 (consider enabling only after the build with the sheet is live, or accept that). Manual check: two browsers on a pro test account + a third -> oldest gets the dialog; "Use it here" flips it.
  - [ ] PHASE 2: "Your devices" screen (web settings + mobile settings): list (name, last used, this device), sign out one, sign out everywhere. Optional: login-time "choose a device to sign out" prompt instead of auto-LRU.
  - [ ] PHASE 2: sharing signal: alert/admin report when one account is used from many distinct cities in a short window (NOT IP count — firms share NAT).
  - [ ] PR #554 merged + phase-1 mobile headers -> Android 1.0.4 vC22 (EAS 8fac652a) building to INTERNAL. NEXT: user tests (Plans on iPhone/Android with sub bought elsewhere -> "Your plan is active"), then promote vC22 to production (supersedes vC21 in review). iOS: 1.0.4 (build 39) in review WITHOUT #554/#555 -> after approval bump to 1.0.5 and ship.
