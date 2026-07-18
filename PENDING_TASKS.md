# LIBERTASIAN — Pending Tasks

> Last updated: 2026-07-18 (#301 api deploy confirmed shipped 2026-07-15; account-deletion page #305 merged)

Verification rules used for this prune: every PR reference checked with `gh pr view <n> --json state,mergedAt`; every branch reference checked against `git branch -r --no-merged origin/main` after `git fetch --prune`. Items that could not be verified were MOVED to "Needs verification", not deleted.

---

## Owner / billing (genuinely open)

- [x] **Deploy api with #301** — DONE: api deployed + couponed checkout verified in prod 2026-07-15
- [ ] **Xendit go-live key swap** — deactivate the TEST plan FIRST, then swap env to live keys
- [ ] **2026-08-10: verify the first anchor-date recurring charge** collects correctly (first cycle after the anchor-date fix)
- [ ] **Annual interval check** — run one YEAR-interval checkout in sandbox; Xendit sessions doc lists interval DAY|WEEK|MONTH — if `YEAR` 400s, switch annual to `MONTH` × `interval_count: 12`
- [ ] **Activate Cards** as a payment channel
- [ ] **Edu-plan billing launch** — blocked on Xendit sandbox setup
- [ ] Xendit webhook end-to-end test with test payment methods; confirm Nginx webhook route in prod (Session 191 leftover)

## Mobile (next EAS build / store readiness)

- [ ] **Next EAS build / OTA must carry** (all JS-only): #289 annotations + highlights, #290 bookmark upgrade-alert copy, #297 anchor-offset fix + multi-annotation view sheet, #302 coupon input + Home search entry + Digests repair + Digests TabBar — no server deploy moves these. #302's api dependency is satisfied: the #301 api deploy went live 2026-07-15, so the Digests list params no longer 400
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
