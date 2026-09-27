import { NotFoundException } from '@nestjs/common';

import type { RelayContext } from './deep-research.service';
import {
  happyFrames,
  makeMocks,
  received,
  RESULT,
  RUN_ID,
  SOURCES,
  sseResponse,
} from './deep-research.fixtures-spec';
import { formatSseFrame } from './sse-frame-parser';

describe('DeepResearchService.relay', () => {
  let fetchMock: jest.Mock;
  const realFetch = global.fetch;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  function ctx(writes: string[]): RelayContext {
    return {
      runId: RUN_ID,
      organizationId: 'org-1',
      userId: 'user-1',
      isPlatformAdmin: false,
      dto: { question: 'What is the doctrine of last clear chance?' },
      startedAt: Date.now() - 50,
      write: (f) => writes.push(f),
    };
  }

  it('forwards the contract events and rewrites done to exactly five fields', async () => {
    const { service, usageQuota, tenant, prisma } = makeMocks();
    fetchMock.mockResolvedValue(sseResponse(happyFrames()));
    const writes: string[] = [];

    const outcome = await service.relay(ctx(writes));

    expect(outcome).toEqual({ status: 'completed', errorCode: undefined, refunded: false });
    const events = received(writes);
    expect(events.map((e) => e.event)).toEqual([
      'stage', 'plan', 'stage', 'sources', 'stage', 'result', 'done',
    ]);
    const done = events[events.length - 1]!.payload;
    expect(Object.keys(done).sort()).toEqual(
      ['costUsd', 'latencyMs', 'modelName', 'promptTemplateVersion', 'runId'],
    );
    expect(done).toMatchObject({
      runId: RUN_ID,
      modelName: 'gpt-4o-mini',
      promptTemplateVersion: 'deep-research-v1',
      costUsd: 0.0012,
    });
    expect(done['tokensIn']).toBeUndefined();
    expect(events[3]!.payload).toEqual({ sources: SOURCES });
    expect(usageQuota.refund).not.toHaveBeenCalled();

    // Sent to rag: the run id, the scope, and no organization or user.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://rag.test/research/deep');
    expect(JSON.parse(init.body as string)).toEqual({
      question: 'What is the doctrine of last clear chance?',
      run_id: RUN_ID,
      model_override: null,
      scope: 'ai_research',
    });

    expect(prisma.forTenant).toHaveBeenCalledWith('org-1');
    expect(tenant.deepResearchRun.update).toHaveBeenCalledWith({
      where: { id: RUN_ID },
      data: expect.objectContaining({
        status: 'completed',
        resultJson: RESULT,
        sourcesJson: SOURCES,
        subQueriesJson: ['q1', 'q2', 'q3'],
        modelName: 'gpt-4o-mini',
        promptTemplateVersion: 'deep-research-v1',
        tokensIn: 4000,
        tokensOut: 1000,
        costUsd: 0.0012,
      }),
    });
    expect(prisma.modelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        runType: 'deep_research',
        modelVersion: 'gpt-4o-mini-2024-07-18',
        promptTemplateVersion: 'deep-research-v1',
        outputRef: 'completed',
      }),
    });
    expect(prisma.budgetLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ scope: 'ai_research', amountUsd: 0.0012 }),
    });
  });

  it('persists before it writes done, so GET /:runId never shows running', async () => {
    const { service, tenant } = makeMocks();
    fetchMock.mockResolvedValue(sseResponse(happyFrames()));
    const order: string[] = [];
    tenant.deepResearchRun.update.mockImplementation(async () => {
      order.push('persist');
      return {};
    });
    const c = ctx([]);
    c.write = (f) => {
      if (f.startsWith('event: done')) order.push('done');
    };
    await service.relay(c);
    expect(order).toEqual(['persist', 'done']);
  });

  it('refunds the unit when rag abstains, and still sends done', async () => {
    const { service, usageQuota, tenant } = makeMocks();
    fetchMock.mockResolvedValue(
      sseResponse(
        happyFrames({
          summary: 'Not enough sources.',
          sections: [],
          removedClaims: 0,
          abstained: true,
          abstainReason: 'insufficient_passages',
        }),
      ),
    );
    const writes: string[] = [];
    const outcome = await service.relay(ctx(writes));

    expect(outcome.status).toBe('abstained');
    expect(usageQuota.refund).toHaveBeenCalledWith(
      'org-1', 'user-1', 'deepResearchPerMonth', { isPlatformAdmin: false },
    );
    expect(tenant.deepResearchRun.update.mock.calls[0][0].data.status).toBe('abstained');
    expect(received(writes).map((e) => e.event)).toContain('done');
  });

  it('refunds on an upstream budget_exhausted error event and sends no done', async () => {
    const { service, usageQuota } = makeMocks();
    fetchMock.mockResolvedValue(
      sseResponse([
        formatSseFrame('stage', { stage: 'planning' }),
        formatSseFrame('error', { code: 'budget_exhausted', message: 'AI unavailable' }),
      ]),
    );
    const writes: string[] = [];
    const outcome = await service.relay(ctx(writes));

    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'budget_exhausted', refunded: true });
    expect(usageQuota.refund).toHaveBeenCalledTimes(1);
    const events = received(writes);
    expect(events[events.length - 1]).toEqual({
      event: 'error',
      payload: { code: 'budget_exhausted', message: 'AI unavailable' },
    });
    expect(events.map((e) => e.event)).not.toContain('done');
  });

  it('maps an upstream 503 provider_quota_exhausted to budget_exhausted', async () => {
    const { service, usageQuota } = makeMocks();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'provider_quota_exhausted' }), { status: 503 }),
    );
    const writes: string[] = [];
    const outcome = await service.relay(ctx(writes));
    expect(outcome.errorCode).toBe('budget_exhausted');
    expect(usageQuota.refund).toHaveBeenCalled();
    expect(received(writes)[0]!.payload['code']).toBe('budget_exhausted');
  });

  it('maps any other upstream failure to internal and refunds', async () => {
    const { service, usageQuota, tenant } = makeMocks();
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    const writes: string[] = [];
    const outcome = await service.relay(ctx(writes));
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'internal' });
    expect(usageQuota.refund).toHaveBeenCalled();
    expect(tenant.deepResearchRun.update.mock.calls[0][0].data.status).toBe('failed');
  });

  it('treats a stream that ends without done as failed', async () => {
    const { service, usageQuota } = makeMocks();
    fetchMock.mockResolvedValue(sseResponse(happyFrames().slice(0, 4)));
    const writes: string[] = [];
    const outcome = await service.relay(ctx(writes));
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'internal' });
    expect(usageQuota.refund).toHaveBeenCalled();
    const events = received(writes);
    expect(events[events.length - 1]!.event).toBe('error');
  });

  it('treats a network error as failed/internal', async () => {
    const { service, usageQuota } = makeMocks();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const outcome = await service.relay(ctx([]));
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'internal', refunded: true });
    expect(usageQuota.refund).toHaveBeenCalled();
  });
});

describe('DeepResearchService reads (tenant + owner scoping)', () => {
  it('findById scopes by the caller org AND user, and 404s otherwise', async () => {
    const { service, prisma, tenant } = makeMocks();
    tenant.deepResearchRun.findFirst.mockResolvedValue(null);
    await expect(service.findById('org-A', 'user-A', RUN_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.forTenant).toHaveBeenCalledWith('org-A');
    expect(tenant.deepResearchRun.findFirst).toHaveBeenCalledWith({
      where: { id: RUN_ID, userId: 'user-A' },
    });
  });

  it('list is keyset-paginated over the caller’s own runs', async () => {
    const { service, tenant } = makeMocks();
    const rows = [1, 2, 3].map((n) => ({
      id: `id-${n}`,
      question: 'q',
      status: 'completed',
      modelName: 'gpt-4o-mini',
      createdAt: new Date(),
      latencyMs: 10,
      costUsd: { toString: () => '0.001' },
    }));
    tenant.deepResearchRun.findMany.mockResolvedValue(rows);
    const out = await service.list('org-1', 'user-1', { limit: 2, cursor: RUN_ID });
    expect(tenant.deepResearchRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        take: 3,
        cursor: { id: RUN_ID },
        skip: 1,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(out.items).toHaveLength(2);
    expect(out.items[0]!.costUsd).toBe(0.001);
    expect(out.meta).toEqual({ nextCursor: 'id-2', hasMore: true });
  });

  it('delete removes only the caller’s own run and 404s otherwise', async () => {
    const { service, tenant } = makeMocks();
    tenant.deepResearchRun.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.delete('org-1', 'user-1', RUN_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tenant.deepResearchRun.deleteMany).toHaveBeenCalledWith({
      where: { id: RUN_ID, userId: 'user-1' },
    });
  });
});
