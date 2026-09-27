import {
  runDetailSchema,
  runListItemSchema,
  type DeepResearchRunDetail,
  type DeepResearchRunListPage,
} from './types';

/**
 * Envelope resolution for the Deep Research REST routes, made explicit.
 *
 * `apiClient` strips a `{ success, data }` envelope ONLY when those are its
 * only keys (`unwrapEnvelope` in lib/api-client.ts). The two read routes land
 * on opposite sides of that rule:
 *
 *   GET /deep-research      → `{ success, data: Run[], meta }` — has `meta`,
 *                             so it arrives STILL WRAPPED; read `.data`/`.meta`.
 *   GET /deep-research/:id  → `{ success, data: Run }` — arrives UNWRAPPED;
 *                             the payload IS the run. A second `.data` here is
 *                             the double-unwrap bug this repo has shipped
 *                             before (use-quotas.ts, use-memos.ts).
 *
 * Both resolvers tolerate the other shape too, so a change to the transport
 * rule degrades to "still works" rather than to an empty screen — and
 * `envelope.test.ts` pins both real shapes.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class DeepResearchPayloadError extends Error {
  constructor(what: string) {
    super(`Unexpected ${what} response`);
    this.name = 'DeepResearchPayloadError';
  }
}

export function resolveRunListPage(payload: unknown): DeepResearchRunListPage {
  let rows: unknown;
  let meta: unknown;

  if (Array.isArray(payload)) {
    // Unwrapped by a future transport change: no pagination info survives.
    rows = payload;
  } else if (isRecord(payload) && Array.isArray(payload['data'])) {
    rows = payload['data'];
    meta = payload['meta'];
  } else {
    throw new DeepResearchPayloadError('history');
  }

  // Row-level leniency: one malformed row is dropped, not the whole page.
  const items = (rows as unknown[]).flatMap((row) => {
    const parsed = runListItemSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });

  const nextCursor =
    isRecord(meta) && typeof meta['nextCursor'] === 'string' ? meta['nextCursor'] : null;
  const hasMore = isRecord(meta) && meta['hasMore'] === true && nextCursor !== null;

  return { items, nextCursor: hasMore ? nextCursor : null, hasMore };
}

export function resolveRunDetail(payload: unknown): DeepResearchRunDetail {
  let candidate: unknown = payload;
  // Only descend when the payload is NOT itself a run: a run has an `id`.
  if (isRecord(payload) && !('id' in payload) && isRecord(payload['data'])) {
    candidate = payload['data'];
  }
  const parsed = runDetailSchema.safeParse(candidate);
  if (!parsed.success) throw new DeepResearchPayloadError('run');
  return parsed.data;
}
