# Silent-Catch Audit — apps/api — 2026-05-28

## Background

**Case study — PR #197 (commit `de587ee`, today):** the `otplib` v13 upgrade silently broke MFA. The function `verifyTotpRaw` in `apps/api/src/modules/auth/auth.service.ts` had a bare `catch { return false }` around the `otplib` call. When the v13 API shape changed, `authenticator.check` threw a `TypeError` at runtime — and the catch swallowed it, returning `false` for every TOTP attempt. There were no logs. The regression went undetected for an unknown period before users reported `/auth/mfa/enroll` returning 500.

This audit checks the same class of bug elsewhere in `apps/api`: `catch` blocks that swallow errors with no log line and no rethrow, where a regression of equivalent severity could hide the same way.

## Scope

- **In scope:** `apps/api/src/**/*.ts`, excluding `*.spec.ts`, `*.test.ts`, `__tests__/`, and `prisma/seed*`.
- **Out of scope (deferred to separate audits):** `apps/web` (Next.js), `services/*` (Python — `rag-service`, `worker-service`, `embedding-service`, `ocr-service`), `packages/*`, `infrastructure/`. Web has its own swallow patterns (`.catch()` in TanStack Query, fetch wrappers, route handlers); Python has `except: pass` and bare `except Exception:` equivalents. Both warrant their own audits.

## Method

Five ripgrep sweeps over `apps/api/src/**/*.ts` (excluding test files):

1. `catch\s*\{` — bare empty catch.
2. `catch\s*\([^)]*\)\s*\{\s*\}` — named empty catch.
3. `catch\s*(\([^)]*\))?\s*\{\s*return\s+(false|null|undefined|\[\]|\{\})\s*;?\s*\}` — bare-fallback return.
4. `\.catch\(\s*\(\s*\)\s*=>\s*(false|null|undefined|\[\]|\{\})\s*\)` — promise silent fallback.
5. `catch\s*\([^)]+\)\s*\{[\s\S]{0,250}?\}` — short catch bodies (manual filter for those without `logger`/`console`/`throw`).

For each hit, read 8–15 lines of context to see what's inside the `try` and whether the swallow is intentional and documented.

## Summary

| Risk class | Count | Logged in this PR | Deferred / Accepted |
|---|---|---|---|
| HIGH (auth, MFA, JWT, RBAC, tenant, billing, AES, upload) | 4 | 4 | 0 |
| MEDIUM (DB / external service / background job) | 2 | 0 | 2 deferred |
| LOW (deliberate fallback or already logged at debug+) | 15 | 0 | 15 accepted |
| **Total silent-catch sites in `apps/api/src` (non-test)** | **21** | **4** | **17** |

PR #197 closed one HIGH finding (`verifyTotpRaw`, `auth.service.ts:890`). This PR closes the four HIGH findings that remained.

---

## HIGH findings — logged in this PR

### 1. `apps/api/src/modules/auth/auth.service.ts:880` — `verifyTotp` outer catch

**Pattern:**

```ts
verifyTotp(encryptedSecret: string, code: string): boolean {
  try {
    const encryptionKey = this.config.get<string>('ENCRYPTION_KEY', '');
    const secret = encryptionKey
      ? this.decryptAes256Gcm(encryptedSecret, encryptionKey)
      : encryptedSecret;
    return this.verifyTotpRaw(secret, code);
  } catch {
    return false;
  }
}
```

**What's inside the `try`:** AES-256-GCM decryption of the stored TOTP secret, plus the inner `verifyTotpRaw`. Failures here include: malformed encrypted blob, wrong/rotated `ENCRYPTION_KEY`, GCM authentication-tag mismatch, or any thrown error escaping `verifyTotpRaw` itself.

**Why high-risk:** Identical bug class to PR #197 — one level up the call stack. PR #197 fixed `verifyTotpRaw`'s inner swallow, but the *outer* `verifyTotp` still silently returns `false` on AES failure. If `ENCRYPTION_KEY` rotates incorrectly, every MFA verification returns `false` with zero log signal. This is the public entry point used by `MfaGuard`; a regression here breaks login for every MFA-enrolled user.

**Action:** added `warn` log capturing the error message. No return-value change, no rethrow.

### 2. `apps/api/src/modules/notifications/notifications.gateway.ts:130` — `verifyToken` JWT verify

**Pattern:**

```ts
private async verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const secretOrKey = this.resolveVerificationKey();
    const algorithms = this.resolveAlgorithms();
    const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
      secret: secretOrKey,
      algorithms,
    });
    if (!payload.sub || !payload.email) return null;
    return payload;
  } catch {
    return null;
  }
}
```

**What's inside the `try`:** key resolution (file read, base64 decode) + `jwtService.verifyAsync`. Failures include: JWT signature mismatch, expired token, malformed token, missing/unreadable key file, base64 decode error, algorithm mismatch.

**Why high-risk:** This is the WebSocket auth path for the notifications gateway. The caller logs only `"verification error"` at `debug` level (line 98) — error detail is discarded. A regression that changes the JWT verification API (similar to the `otplib` shape change) would reject every WebSocket connection silently. JWT verify is on the brief's HIGH list explicitly.

**Action:** added `warn` log capturing the error message. No return-value change.

### 3. `apps/api/src/modules/sources/ingestion-scheduler.service.ts:195` — `isBudgetExceeded` Redis read

**Pattern:**

```ts
private async isBudgetExceeded(): Promise<boolean> {
  try {
    const budgetRaw = await this.redis.get('llm:config:monthly_budget_usd');
    if (!budgetRaw) return false;
    const budget = parseFloat(budgetRaw);
    if (budget <= 0) return false;
    // ... read monthly usage cost from Redis hash ...
    return cost >= budget;
  } catch {
    return false;
  }
}
```

**What's inside the `try`:** two Redis reads (`get` and `hget`) plus `parseFloat` of the result.

**Why high-risk:** This is a **fail-open billing/budget check**. Returning `false` means "budget is NOT exceeded — allow further AI inference." If Redis becomes unreachable, or the budget keys get corrupted, the scheduler silently waves through AI calls past the configured monthly cap. This is exactly the cost-control circuit-breaker that needs visibility when it fails.

**Action:** added `warn` log capturing the error message. No return-value change (fail-open behavior preserved; visibility added).

### 4. `apps/api/src/modules/ai-settings/model-runs.controller.ts:87` — fire-and-forget budget threshold check

**Pattern:**

```ts
// Check budget thresholds after recording usage
// Fire-and-forget — don't block the response
this.aiSettings.checkBudgetThresholds().catch(() => {});
```

**What's inside the promise:** `AiSettingsService.checkBudgetThresholds()` reads month-to-date usage and posts alerts when configured warning/cap thresholds are crossed.

**Why high-risk:** This is the only call site that triggers budget-threshold alerts on every model-run record. Silently dropping the rejection means a Redis hiccup or downstream alert-send failure produces zero log signal — and ops never learns that budget alerts stopped firing. Billing/budget enforcement is HIGH per the brief.

**Action:** added `warn` log via `.catch((err) => this.logger.warn(...))`. Required adding a `Logger` field to the controller (no logger existed on it). Behavior unchanged — alert send still fire-and-forget, just observable now.

---

## MEDIUM findings — deferred

| Site | Inside `try` | Catch shape | Suggested follow-up |
|---|---|---|---|
| `apps/api/src/modules/subscriptions/subscription-lifecycle.service.ts:485` | `plansService.findByCode(planCode)` for trial duration lookup | `} catch { /* Use default */ }` | Add `warn` log; falling back to the hard-coded 14-day default silently hides plan-mismatch bugs |
| `apps/api/src/modules/promotions/promotion-rule-engine.service.ts:331` | `pricingEngine.resolvePlanPrice(planCode, billingPeriod, organizationId)` | `} catch { return undefined; }` | Add `warn` log; discount-preview disappears with no signal when pricing resolution fails |

---

## LOW findings — accepted

| Site | Justification |
|---|---|
| `apps/api/src/modules/promotions/promotion-rule-engine.service.ts:234` | JSON.parse of cached eligibility — comment "Corrupted cache, continue with fresh query"; falls through to authoritative DB query |
| `apps/api/src/modules/promotions/promotion-rule-engine.service.ts:275` | JSON.parse of cached pricing-page promotions — same deliberate corrupt-cache recovery pattern |
| `apps/api/src/modules/rbac/rbac-cache.service.ts:33` | JSON.parse of cached permission codes — on failure: `redis.del` the bad key + return null so caller re-resolves from authoritative DB |
| `apps/api/src/modules/uploads/user-upload-search.service.ts:158` | `} catch { errors++; this.logger.warn(...) }` — already warn-logged at line 160; not silent |
| `apps/api/src/modules/health/health.service.ts:18` | `/health` DB probe — returning `{ status: 'down' }` *is* the signal the endpoint exists to emit |
| `apps/api/src/modules/uploads/s3.service.ts:137` | `exists(objectKey)` HEAD → returns `false` on any error. Documented `exists` semantics; callers always handle `false` |
| `apps/api/src/modules/uploads/ocr-client.service.ts:345` | `isHealthy()` — returning `false` *is* the contract; caller treats as "service down" |
| `apps/api/src/modules/search/opensearch.service.ts:276` | `onModuleInit` — `} catch { this.logger.warn('OpenSearch not available — search features will be degraded') }`; already warn-logged |
| `apps/api/src/modules/search/opensearch.service.ts:525` | Suggestions search — `} catch { this.logger.error('Suggestions search failed'); return []; }`; already error-logged |
| `apps/api/src/modules/search/embedding-client.service.ts:43` | `onModuleInit` — already warn-logged at lines 44–46 |
| `apps/api/src/modules/search/embedding-client.service.ts:122` | `isAvailable()` — returning `false` *is* the contract |
| `apps/api/src/modules/subscriptions/subscriptions.service.ts:105` | Plan DB resolution → hardcoded fallback; already warn-logged at line 107 |
| `apps/api/src/modules/pricing/pricing-engine.service.ts:98` | DB plan resolution → hardcoded fallback; already warn-logged at lines 99–101 |
| `apps/api/src/common/services/celery-dispatcher.service.ts:129` | `JSON.stringify(value)` for the `argsrepr`/`kwargsrepr` debug-only header; fallback `<unrepresentable>` is benign and documented |
| `apps/api/src/modules/notifications/notifications.gateway.ts:97` | Outer connection-handler catch — already `this.logger.debug('Client X rejected: verification error')`; auth churn is routine and debug-level is defensible (HIGH detail captured upstream by the per-failure inner verify at #2 above) |
| `apps/api/src/modules/analytics/analytics.service.ts:134` | `.catch(() => { /* swallow Redis errors for analytics */ })` — explicit deliberate fire-and-forget; analytics counter loss is acceptable; comment documents intent |

---

## Out-of-scope (apps/web, services/*) — for follow-up audits

Two known classes of swallow not audited here:

- **`apps/web`** — fetch wrappers in `apps/web/src/lib/api/*`, TanStack Query `onError` defaults, server-action `try/catch` blocks, and middleware `redirect()` paths. Should be audited with the same rg patterns plus `.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)` and `try.*catch.*null` patterns. Separate PR.
- **`services/*` (Python)** — equivalents are `except: pass`, `except Exception: pass`, `except Exception: return None`, and bare `except: return False`. Search across `services/rag-service/src`, `services/worker-service/src`, `services/embedding-service/src`, `services/ocr-service/src`. Separate PR.

Both deferrals are tracked here so a future maintainer doesn't have to re-discover the gap.
