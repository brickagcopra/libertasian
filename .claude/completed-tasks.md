# Completed Tasks

## Security Hardening (2026-04-08)

### Section 1: Secure API Documentation & Python Services
- [x] 1.1 Disabled Swagger docs in production (NODE_ENV check in main.ts, nginx returns 404)
- [x] 1.2 Added internal API key auth to all Python services:
  - Created `shared/auth.py` with `verify_internal_key` dependency in RAG, OCR, Embedding services
  - Added `internal_api_key` to all three service configs
  - Added `Depends(verify_internal_key)` to ALL routers (12 RAG, 5 OCR, 1 Embedding)
  - Added X-Internal-Api-Key header to NestJS client services (ocr-client, ai-answers, embedding-client)
  - Added env vars to docker-compose.prod.yml
- [x] 1.3 Removed hardcoded credentials (minioadmin defaults, dev-internal-api-key)

### Section 2: Harden CSP, Security Headers, Fix XSS
- [x] 2.1 Removed 'unsafe-inline' from script-src, added font-src, base-uri, form-action
- [x] 2.2 Replaced weak ssl_ciphers with explicit modern cipher suite
- [x] 2.3 Changed camera=(self) to camera=() in Permissions-Policy
- [x] 2.4 Added DOMPurify sanitization to search-result-card.tsx and scans/search/page.tsx
- [x] 2.5 Added withSecurityHeaders helper to Next.js middleware.ts

### Section 3: Fix Dependency Vulnerabilities
- [x] Added pnpm.overrides for handlebars, tar, picomatch, node-forge
- [x] Updated nodemailer

### Section 4: Enforce Production Security in NestJS
- [x] 4.1 Added production RS256 requirement check in auth.service.ts
- [x] 4.2 Added @Throttle(60 req/min) to all 6 public document GET endpoints
- [x] 4.3 Added @Throttle(30 req/min) to search, citation, suggestions endpoints

### Section 5: Harden Python Services
- [x] 5.1 Added Image.MAX_IMAGE_PIXELS = 100_000_000 to scorer.py and enhance.py
- [x] 5.2 Added magic byte validation for uploaded images in OCR router
- [x] 5.3 Added ALLOWED_DOMAINS frozenset and _validate_url to base fetcher + all 4 concrete fetchers
- [x] 5.4 Changed query logging to log only query_length (no PII)

### Section 6: Docker Network Segmentation
- [x] Added 4 bridge networks: frontend, backend, ai, storage
- [x] Assigned each service to appropriate networks

### Verification
- [x] pnpm lint — pre-existing eslint PATH issue in @libertasian/types (not from changes)
- [x] pnpm --filter api test — 2434 passed, 30 pre-existing failures in analytics-aggregation
- [x] pnpm --filter web build — successful
- [x] ruff check on RAG, OCR, Worker — no new errors from changes (E402 fix committed)
- [x] mypy on RAG service — all errors pre-existing (missing stubs, generic types)

### Commits
1. `14a9503` security: protect Swagger docs, add internal auth to Python services, remove hardcoded credentials
2. `aeb6bd3` security: harden CSP and cipher suites, sanitize HTML rendering, add security headers
3. `8cbdf05` security: upgrade vulnerable dependencies
4. `f4f6b92` security: enforce RS256 in production, add rate limits to public endpoints
5. `6f2c869` security: harden OCR service, strengthen URL allowlisting, reduce PII logging
6. `1a0f9f7` security: add Docker network segmentation
7. `77a6026` fix: move PIL pixel limit after imports to fix E402 ruff errors

---

## OpenAI API Integration + Admin AI Settings Panel (2026-04-08)

### Part 1: Switch Generation Layer from vLLM to OpenAI API
- [x] 1.1 Added `openai>=1.60.0` to `services/rag-service/pyproject.toml`
- [x] 1.2 Updated `services/rag-service/src/config.py` with OpenAI settings (api_key, model, timeout) + vLLM fallback
- [x] 1.3 Rewrote `services/rag-service/src/core/generation.py`:
  - AsyncOpenAI client (lazy singleton) when `openai_api_key` is set
  - vLLM httpx fallback when no API key
  - Redis token usage tracking (HINCRBY `llm:usage:{YYYY-MM}`)
  - Budget enforcement via `llm:config:monthly_budget_usd` Redis key
  - MODEL_PRICING dict for cost estimation
  - Same public function signatures (`generate_completion` -> str, `stream_completion` -> AsyncIterator[str])
- [x] 1.3b Added `BudgetExceededError` to `services/rag-service/src/shared/exceptions.py`
  - Global FastAPI exception handler in `main.py` returns HTTP 503
  - Answer router re-raises before catching `RagPipelineError`
- [x] 1.4 Updated `.env.example` with `RAG_OPENAI_API_KEY`, `RAG_OPENAI_MODEL`, `RAG_OPENAI_REQUEST_TIMEOUT`

### Part 2: Admin AI Settings Panel
- [x] 2.1 Added `AiSettings` model to Prisma schema + User relation
- [x] 2.2 Created NestJS `AiSettingsModule` (service, controller, DTOs, model-runs endpoint)
- [x] 2.3 Created `ingestion-scheduler.service.ts` in sources module
- [x] 2.4 Created admin AI Settings web page with usage tracking and ingestion scheduling

### Part 3: Budget Alert Notifications
- [x] Created `budget-alert.ts` email template
- [x] Added `checkBudgetThresholds()` to AiSettingsService (75%, 90%, 100% thresholds)

### Part 4: Internal Model Runs Endpoint
- [x] Created `POST /api/v1/internal/model-runs` (InternalApiGuard, no JWT)
- [x] Records model run in `model_runs` table
