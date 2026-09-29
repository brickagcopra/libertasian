# Pending Tasks

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
