import { AsyncLocalStorage } from 'async_hooks';

import type {
  ClientPlatform,
  ClientSurface,
} from '../config/store-availability';

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

  /**
   * Which client issued the request — see `resolveClientSurface`.
   *
   * Carried ALONGSIDE `platform`, not instead of it. They answer different
   * questions: `platform` is "can this client buy from a store?", `surface` is
   * "which client is this?". Only `surface` can tell a browser apart from live
   * App Store build 25, because both send no `x-platform` header and both have
   * a `null` platform.
   *
   * OPTIONAL, and absent means `null` = never web-enforced. Callers that
   * construct a context by hand — tests, and anything simulating a request —
   * keep working unchanged and keep today's behaviour, which is the safe
   * direction. The middleware always sets it.
   */
  surface?: ClientSurface | null;
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
 * The current request's client surface, or `null` when there is no request.
 *
 * `null` OUTSIDE A REQUEST IS THE SAFE DEFAULT, for the same reason as
 * `getRequestPlatform`: a BullMQ worker, a `@Cron` sweep or a seed has no
 * headers to read and no user waiting on a paywall, and `null` is the one value
 * `isPaywallEnforcedForRequest` never enforces on. Note this is NOT the same
 * default as `resolveClientSurface`, which returns `'web'` for an
 * unidentifiable HTTP client — there, a request really did arrive and the
 * question is which client sent it; here, no request exists at all.
 */
export function getRequestSurface(): ClientSurface | null {
  return requestContextStorage.getStore()?.surface ?? null;
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
