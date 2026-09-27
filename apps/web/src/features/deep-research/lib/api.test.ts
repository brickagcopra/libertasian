import { describe, expect, it } from 'vitest';

import {
  DeepResearchEnvelopeError,
  resolveHttpError,
  resolveRunDetail,
  resolveRunPage,
} from './api';

const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  question: 'Q?',
  status: 'completed',
  modelName: 'm',
  createdAt: '2026-09-01T00:00:00.000Z',
  latencyMs: 1200,
  costUsd: 0.02,
};

describe('resolveRunPage (GET /deep-research)', () => {
  it('unwraps exactly one level: data is the array, meta.hasMore drives the cursor', () => {
    const page = resolveRunPage({
      success: true,
      data: [ROW],
      meta: { nextCursor: ROW.id, hasMore: true },
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.question).toBe('Q?');
    expect(page.nextCursor).toBe(ROW.id);
    expect(page.hasMore).toBe(true);
  });

  it('has no next cursor on the last page', () => {
    const page = resolveRunPage({ success: true, data: [], meta: { nextCursor: null, hasMore: false } });
    expect(page.nextCursor).toBeNull();
  });

  it('rejects a double-wrapped body instead of rendering an empty list', () => {
    expect(() =>
      resolveRunPage({ success: true, data: { data: [ROW], meta: { nextCursor: null, hasMore: false } } }),
    ).toThrow(DeepResearchEnvelopeError);
  });

  it('rejects an already-unwrapped array', () => {
    expect(() => resolveRunPage([ROW])).toThrow(DeepResearchEnvelopeError);
  });
});

describe('resolveRunDetail (GET /deep-research/:id)', () => {
  const detail = {
    ...ROW,
    resultJson: { summary: 'S', sections: [], removedClaims: 0, abstained: false },
    sourcesJson: [{ sourceId: 'S1', documentId: 'd', title: 'T' }],
    subQueriesJson: ['a'],
    promptTemplateVersion: 'v1',
    organizationId: 'org',
    userId: 'u',
    tokensIn: 1,
    tokensOut: 2,
  };

  it('returns body.data with the saved JSON columns parsed', () => {
    const run = resolveRunDetail({ success: true, data: detail });
    expect(run.resultJson?.summary).toBe('S');
    expect(run.sourcesJson?.[0]?.sourceId).toBe('S1');
  });

  it('accepts a failed run with null JSON columns', () => {
    const run = resolveRunDetail({
      success: true,
      data: { ...ROW, status: 'failed', resultJson: null, sourcesJson: null, subQueriesJson: null },
    });
    expect(run.resultJson).toBeNull();
  });

  it('rejects the unwrapped row (double-unwrap guard)', () => {
    expect(() => resolveRunDetail(detail)).toThrow(DeepResearchEnvelopeError);
  });
});

describe('resolveHttpError (POST /deep-research/stream refusals)', () => {
  it('branches on code, not on the filter-overwritten error field', () => {
    const e = resolveHttpError(402, {
      code: 'subscription_required',
      error: 'PAYMENT_REQUIRED',
      message: "This isn't available on this account.",
    });
    expect(e.code).toBe('subscription_required');
  });

  it('quota_exceeded carries resetAt and limit', () => {
    const e = resolveHttpError(429, {
      code: 'quota_exceeded',
      error: 'TOO_MANY_REQUESTS',
      message: 'Monthly Deep Research quota exceeded.',
      resetAt: '2026-10-01T00:00:00.000Z',
      limit: 20,
    });
    expect(e).toMatchObject({ code: 'quota_exceeded', resetAt: '2026-10-01T00:00:00.000Z', limit: 20 });
  });

  it('a 429 without code is the hourly throttle, not the monthly quota', () => {
    expect(resolveHttpError(429, { error: 'TOO_MANY_REQUESTS' }).code).toBe('rate_limited');
  });

  it('a plain tier 403 is treated as subscription_required', () => {
    expect(resolveHttpError(403, { message: 'x' }).code).toBe('subscription_required');
  });

  it('anything else is internal', () => {
    expect(resolveHttpError(500, null).code).toBe('internal');
  });
});
