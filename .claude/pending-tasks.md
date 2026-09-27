# Pending Tasks

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

## RAG / Deep Research (2026-09-26)
- [ ] Merge PR #503, run baseline eval on prod BEFORE deploying #504
- [ ] Merge + deploy PR #504, re-run eval, `evals.compare` vs baseline
- [ ] Lawyer review of golden set (all `reviewed: false`); low-confidence G.R. Nos: lab-03, merc-02, crim-03, eth-02
- [ ] Prompt 3 (P1-A Deep Research backend) — after #504 merged
- [ ] Prompts 4 (web) + 5 (mobile) — after P1-A PR is open

## Chores
- [ ] chore: fix 40 pre-existing rag-service `tests/test_routers.py` setup errors ("requested an async fixture 'client'", pytest 9 + pytest-asyncio); present on main
