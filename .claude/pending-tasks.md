# Pending Tasks

## Deep Research client follow-ups (2026-09-27, after #508 / #509 merged)
- [ ] Mobile reader: honour the `section` param and highlight the passage (parity with web `pinpoint.ts`). Today "Open in reader" opens the document, not the passage.
- [ ] Login redirect drops the query string (`?q=` is lost on `/research?q=`). The same thing happens on main.
- [ ] Web UpgradeBanner → "subscribe in the iOS app" CTA (decided 09-20) before `PAYWALL_ENFORCED_WEB` is set. Applies to Deep Research and Memos. It never shows today: the flag is unset in prod, so every web user counts as pro.
- [ ] 16 pre-existing e2e failures in `subscription-enforcement` + `entitlement-enforcement-gaps`.
- [ ] Duplicate `@types/react` (tsc reports 397 errors on main).

## Deep Research (2026-09-26, feature/PHASE-1-deep-research-api, PR open, NOT merged)
- [ ] **Acceptance gate before shipping:** run `python -m evals.run --endpoint deep` on prod (45-question golden set) and compare it against the /answer result file with `python -m evals.compare ... --k 8`. It ships only if authority_hit@8 > 0.525, citation_validity = 1.0, and no must-abstain question is answered.
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
