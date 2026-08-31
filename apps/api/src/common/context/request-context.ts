import { AsyncLocalStorage } from 'async_hooks';

import type { ClientPlatform } from '../config/store-availability';

/**
 * Per-request ambient context.
 *
 * Deliberately tiny. This is not a general-purpose grab bag: anything added
 * here becomes implicitly readable from every layer of the app, which is
 * exactly the property that makes it dangerous. Add a field only when
 * threading it explicitly is genuinely infeasible.
 */
export interface RequestContext {
  /**
   * The calling client's platform, parsed once from the `x-platform` header.
   *
   * `null` means "no platform with an in-app store" — web, an absent header, or
   * an unrecognised value. See `store-availability.ts`.
   */
  platform: ClientPlatform | null;
}

/**
 * AsyncLocalStorage holding the current request's context.
 *
 * WHY ALS AND NOT A MODULE-LEVEL VARIABLE: Node serves many requests
 * concurrently on one thread. A module-level `let currentPlatform` would be
 * overwritten by whichever request most recently entered the middleware, so an
 * iOS request awaiting a DB round-trip would resume and read a web request's
 * platform. That is a cross-request data leak that decides whether a user is
 * gated, and it would appear only under concurrency — never in a sequential
 * test. `request-context.spec.ts` pins this with interleaved async calls.
 *
 * Exported for the middleware and for tests; prefer `getRequestPlatform()`
 * and `runWithRequestContext()` over touching the store directly.
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * The current request's client platform, or `null` when there is no request.
 *
 * `null` OUTSIDE A REQUEST IS THE SAFE DEFAULT AND IS LOAD-BEARING. BullMQ
 * workers, `@Cron` sweeps, seeds and one-off scripts all resolve entitlements
 * with no HTTP request in scope. `null` means "no purchase-capable platform",
 * which means NOT ENFORCED — i.e. exactly today's behaviour for every
 * background path. A default of anything else would silently start gating
 * work that no user is waiting on and that has no way to present a paywall.
 */
export function getRequestPlatform(): ClientPlatform | null {
  return requestContextStorage.getStore()?.platform ?? null;
}

/**
 * Run `fn` inside a request context. Used by the middleware, and by tests that
 * need to simulate a request without going through HTTP.
 */
export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => T,
): T {
  return requestContextStorage.run(context, fn);
}
