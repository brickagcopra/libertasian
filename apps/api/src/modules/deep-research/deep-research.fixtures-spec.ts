import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../prisma/prisma.service';
import type { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { DeepResearchService } from './deep-research.service';
import { formatSseFrame, SseFrameParser } from './sse-frame-parser';

/**
 * Shared doubles for the deep-research specs. Named *fixtures-spec.ts so the
 * build (which excludes files ending in spec.ts) skips it, and jest (which only
 * runs files ending in .spec.ts) does not run it as a suite.
 */
export const RUN_ID = '11111111-1111-4111-8111-111111111111';

export const RESULT = {
  summary: 'Summary',
  sections: [
    {
      heading: 'H',
      claims: [{ text: 'Claim', citations: [{ sourceId: 'S1', quote: 'verbatim words' }] }],
    },
  ],
  removedClaims: 1,
  abstained: false,
};

export const SOURCES = [
  {
    sourceId: 'S1',
    documentId: 'doc-1',
    sectionId: 'sec-1',
    title: 'People v. X',
    citation: 'G.R. No. 123456',
    grNo: '123456',
    court: 'Supreme Court',
    date: '2020-01-01',
    sectionLabel: 'Ruling',
    documentType: 'decision',
  },
];

export const RAG_DONE = {
  runId: RUN_ID,
  modelName: 'gpt-4o-mini',
  promptTemplateVersion: 'deep-research-v1',
  latencyMs: 1234,
  costUsd: 0.0012,
  tokensIn: 4000,
  tokensOut: 1000,
  modelVersion: 'gpt-4o-mini-2024-07-18',
};

export function happyFrames(result: Record<string, unknown> = RESULT): string[] {
  return [
    formatSseFrame('stage', { stage: 'planning' }),
    formatSseFrame('plan', { subQueries: ['q1', 'q2', 'q3'] }),
    formatSseFrame('stage', { stage: 'searching', detail: '3 sub-queries' }),
    formatSseFrame('sources', { sources: SOURCES }),
    formatSseFrame('stage', { stage: 'writing' }),
    formatSseFrame('result', result),
    formatSseFrame('done', RAG_DONE),
  ];
}

/** An SSE Response whose body arrives in awkward 7-byte chunks. */
export function sseResponse(frames: string[], status = 200): Response {
  const bytes = new TextEncoder().encode(frames.join(''));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } });
}

export function makeMocks() {
  const tenant = {
    deepResearchRun: {
      create: jest.fn().mockResolvedValue({ id: RUN_ID, createdAt: new Date() }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const prisma = {
    forTenant: jest.fn().mockReturnValue(tenant),
    modelRun: { create: jest.fn().mockResolvedValue({}) },
    budgetLedger: { create: jest.fn().mockResolvedValue({}) },
  };
  const usageQuota = {
    refund: jest.fn().mockResolvedValue(true),
    checkAndIncrement: jest.fn(),
  };
  const config = {
    get: jest.fn((key: string, def?: unknown) =>
      key === 'RAG_SERVICE_URL' ? 'http://rag.test' : key === 'INTERNAL_API_KEY' ? 'k' : def,
    ),
  };
  const service = new DeepResearchService(
    config as unknown as ConfigService,
    prisma as unknown as PrismaService,
    usageQuota as unknown as UsageQuotaService,
  );
  return { tenant, prisma, usageQuota, service };
}

/** Parse what the client received back into {event, payload} pairs. */
export function received(writes: string[]): Array<{ event: string; payload: Record<string, unknown> }> {
  const parser = new SseFrameParser();
  return [...parser.push(writes.join('')), ...parser.flush()].map((f) => ({
    event: f.event,
    payload: JSON.parse(f.data) as Record<string, unknown>,
  }));
}
