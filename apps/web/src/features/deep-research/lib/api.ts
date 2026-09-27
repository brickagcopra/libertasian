/**
 * Envelope resolution for the Deep Research REST routes, in ONE place.
 *
 * `apiClient.get<T>()` returns the raw JSON body. For these routes the body is
 * the controller's own envelope (no global TransformInterceptor wraps it), so
 * each resolver below unwraps exactly one level and validates the shape. A
 * resolver that received an already-unwrapped value fails loudly instead of
 * quietly rendering an empty list — the double-unwrap class of bug.
 */
import {
  runDetailEnvelopeSchema,
  runListEnvelopeSchema,
  type DeepResearchRunDetail,
  type DeepResearchRunPage,
} from '../schemas';

export class DeepResearchEnvelopeError extends Error {
  constructor(route: string) {
    super(`Unexpected response shape from ${route}`);
    this.name = 'DeepResearchEnvelopeError';
  }
}

/** GET /deep-research → `{ data: Run[], meta: { nextCursor, hasMore } }`. */
export function resolveRunPage(body: unknown): DeepResearchRunPage {
  const parsed = runListEnvelopeSchema.safeParse(body);
  if (!parsed.success) throw new DeepResearchEnvelopeError('GET /deep-research');
  return {
    items: parsed.data.data,
    nextCursor: parsed.data.meta.hasMore ? parsed.data.meta.nextCursor : null,
    hasMore: parsed.data.meta.hasMore,
  };
}

/** GET /deep-research/:id → `{ data: Run }`. */
export function resolveRunDetail(body: unknown): DeepResearchRunDetail {
  const parsed = runDetailEnvelopeSchema.safeParse(body);
  if (!parsed.success) throw new DeepResearchEnvelopeError('GET /deep-research/:id');
  return parsed.data.data;
}

// ---- HTTP refusals of POST /deep-research/stream ---------------------------

export type DeepResearchErrorCode =
  | 'quota_exceeded'
  | 'subscription_required'
  | 'budget_exhausted'
  | 'internal'
  | 'rate_limited'
  | 'unauthorized';

export interface DeepResearchError {
  code: DeepResearchErrorCode;
  message: string;
  /** quota_exceeded only: when the monthly counter resets (ISO). */
  resetAt?: string | undefined;
  limit?: number | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Map a non-2xx response of POST /deep-research/stream to an error card.
 *
 * Branches on the body's `code`, NEVER on `error`: HttpExceptionFilter
 * overwrites `error` with the status name (`PAYMENT_REQUIRED`), while it
 * preserves the controller's custom fields (`code`, `resetAt`, `limit`).
 */
export function resolveHttpError(status: number, body: unknown): DeepResearchError {
  const b = isRecord(body) ? body : {};
  const code = b['code'];
  const message = typeof b['message'] === 'string' ? b['message'] : '';

  if (code === 'subscription_required') {
    return { code: 'subscription_required', message };
  }
  if (code === 'quota_exceeded') {
    return {
      code: 'quota_exceeded',
      message,
      resetAt: typeof b['resetAt'] === 'string' ? b['resetAt'] : undefined,
      limit: typeof b['limit'] === 'number' ? b['limit'] : undefined,
    };
  }
  // SubscriptionGuard answers a below-tier caller with a plain 403 while the
  // paywall is NOT enforced for them; the product outcome is the same.
  if (status === 402 || status === 403) {
    return { code: 'subscription_required', message };
  }
  if (status === 401) {
    return { code: 'unauthorized', message: 'Your session expired. Please sign in again.' };
  }
  if (status === 429) {
    // The route's hourly @Throttle backstop: no `code` on that body.
    return {
      code: 'rate_limited',
      message: 'Too many Deep Research requests in a short time. Please wait and try again.',
    };
  }
  if (status === 503) {
    return { code: 'budget_exhausted', message };
  }
  return { code: 'internal', message: 'Deep Research failed. Please try again.' };
}
