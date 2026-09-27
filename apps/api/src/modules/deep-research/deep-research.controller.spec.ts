import { EventEmitter } from 'events';
import {
  ExecutionContext,
  HttpException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import type { JwtPayload } from '@libertasian/types';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminBypassAuditService } from '../../common/services/admin-bypass-audit.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { DeepResearchController, secondsUntil } from './deep-research.controller';
import { DeepResearchService } from './deep-research.service';
import {
  happyFrames,
  makeMocks,
  received,
  RUN_ID,
  sseResponse,
} from './deep-research.fixtures-spec';

const USER = {
  sub: '22222222-2222-4222-8222-222222222222',
  organizationId: '33333333-3333-4333-8333-333333333333',
  role: 'member',
  mfaVerified: true,
} as unknown as JwtPayload;

/** Minimal express Response double that records SSE writes. */
class FakeRes extends EventEmitter {
  headers: Record<string, string> = {};
  writes: string[] = [];
  writableEnded = false;
  destroyed = false;
  flushed = false;
  setHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  flushHeaders() {
    this.flushed = true;
  }
  write(chunk: string) {
    this.writes.push(chunk);
    return true;
  }
  end() {
    this.writableEnded = true;
  }
}

describe('DeepResearchController (unit)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function build() {
    const mocks = makeMocks();
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const controller = new DeepResearchController(
      mocks.service,
      mocks.usageQuota as unknown as UsageQuotaService,
      audit as unknown as AuditService,
    );
    return { ...mocks, audit, controller };
  }

  it('answers 429 quota_exceeded with a Retry-After before any stream is opened', async () => {
    const { controller, usageQuota, tenant } = build();
    const resetsAt = new Date(Date.now() + 90_000).toISOString();
    usageQuota.checkAndIncrement.mockResolvedValue({
      allowed: false, used: 20, limit: 20, remaining: 0, resetsAt,
    });
    const res = new FakeRes();

    const err = await controller
      .stream({ question: 'q?q' }, USER, res as unknown as Response, '1.2.3.4')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    const body = (err as HttpException).getResponse() as Record<string, unknown>;
    expect(body).toMatchObject({
      success: false,
      error: 'quota_exceeded',
      code: 'quota_exceeded',
      resetAt: resetsAt,
      currentUsage: 20,
      limit: 20,
    });
    expect(body['retryAfter']).toBeGreaterThanOrEqual(89);
    expect(tenant.deepResearchRun.create).not.toHaveBeenCalled();
    expect(res.flushed).toBe(false);
  });

  it('answers 402 subscription_required when the effective limit is 0', async () => {
    const { controller, usageQuota } = build();
    usageQuota.checkAndIncrement.mockResolvedValue({
      allowed: false, used: 0, limit: 0, remaining: 0, resetsAt: '',
    });
    const err = await controller
      .stream({ question: 'q?q' }, USER, new FakeRes() as unknown as Response, 'ip')
      .catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(402);
    expect((err as HttpException).getResponse()).toMatchObject({ code: 'subscription_required' });
  });

  it('keeps reading and persists the run after the client disconnects', async () => {
    const { controller, usageQuota, tenant, audit } = build();
    usageQuota.checkAndIncrement.mockResolvedValue({
      allowed: true, used: 1, limit: 20, remaining: 19, resetsAt: '',
    });
    global.fetch = jest.fn().mockResolvedValue(sseResponse(happyFrames())) as unknown as typeof fetch;
    const res = new FakeRes();
    // The client leaves right after the first frame arrives.
    const origWrite = res.write.bind(res);
    res.write = (chunk: string) => {
      const r = origWrite(chunk);
      res.emit('close');
      return r;
    };

    await controller.stream({ question: 'q?q' }, USER, res as unknown as Response, 'ip');

    expect(res.writes).toHaveLength(1);
    expect(tenant.deepResearchRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }),
    );
    expect(usageQuota.refund).not.toHaveBeenCalled();
    expect(res.writableEnded).toBe(true);
    // Audit: create logged without the question text.
    const entry = audit.log.mock.calls[0][0] as { action: string; metadata: Record<string, unknown> };
    expect(entry.action).toBe('deep_research.create');
    expect(JSON.stringify(entry)).not.toContain('q?q');
    expect(entry.metadata['questionLength']).toBe(3);
  });

  it('streams the full contract and a done carrying the run id', async () => {
    const { controller, usageQuota } = build();
    usageQuota.checkAndIncrement.mockResolvedValue({
      allowed: true, used: 1, limit: 20, remaining: 19, resetsAt: '',
    });
    global.fetch = jest.fn().mockResolvedValue(sseResponse(happyFrames())) as unknown as typeof fetch;
    const res = new FakeRes();
    await controller.stream({ question: 'q?q' }, USER, res as unknown as Response, 'ip');
    expect(res.headers['Content-Type']).toBe('text/event-stream');
    const events = received(res.writes);
    expect(events[events.length - 1]).toMatchObject({ event: 'done', payload: { runId: RUN_ID } });
  });

  it('refunds when the run row cannot be created', async () => {
    const { controller, usageQuota, tenant } = build();
    usageQuota.checkAndIncrement.mockResolvedValue({
      allowed: true, used: 1, limit: 20, remaining: 19, resetsAt: '',
    });
    tenant.deepResearchRun.create.mockRejectedValue(new Error('db down'));
    await expect(
      controller.stream({ question: 'q?q' }, USER, new FakeRes() as unknown as Response, 'ip'),
    ).rejects.toThrow('db down');
    expect(usageQuota.refund).toHaveBeenCalledWith(
      USER.organizationId, USER.sub, 'deepResearchPerMonth', { isPlatformAdmin: false },
    );
  });

  it('secondsUntil is at least 1 and tolerates junk', () => {
    expect(secondsUntil('2026-01-01T00:00:10Z', Date.parse('2026-01-01T00:00:00Z'))).toBe(10);
    expect(secondsUntil('2020-01-01T00:00:00Z')).toBe(1);
    expect(secondsUntil('')).toBe(3600);
  });
});

/**
 * The ORDER of refusals, through the real Nest pipeline: guard metadata,
 * SubscriptionGuard, the handler's quota check and HttpExceptionFilter.
 */
describe('DeepResearchController (HTTP ordering)', () => {
  let app: INestApplication;
  let planCode: string;
  let usageQuota: { checkAndIncrement: jest.Mock; refund: jest.Mock };

  beforeEach(async () => {
    planCode = 'free';
    usageQuota = { checkAndIncrement: jest.fn(), refund: jest.fn() };
    const mocks = makeMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [DeepResearchController],
      providers: [
        { provide: DeepResearchService, useValue: mocks.service },
        { provide: UsageQuotaService, useValue: usageQuota },
        { provide: AuditService, useValue: { log: jest.fn() } },
        {
          provide: SubscriptionsService,
          useValue: { getPlanCode: jest.fn(async () => planCode) },
        },
        { provide: AdminBypassAuditService, useValue: { record: jest.fn() } },
        // Paywall enforced for every caller (PAYWALL_ENFORCED=true).
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(true) } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest<{ user: JwtPayload }>().user = USER;
          return true;
        },
      })
      .compile();
    // Unused by these tests, kept so the doubles share one shape.
    void (mocks.prisma as unknown as PrismaService);
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('free + paywall enforced → 402 subscription_required, quota never consulted', async () => {
    const res = await request(app.getHttpServer())
      .post('/deep-research/stream')
      .send({ question: 'What is res judicata?' });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('subscription_required');
    expect(res.body.message).toBe("This isn't available on this account.");
    expect(usageQuota.checkAndIncrement).not.toHaveBeenCalled();
  });

  it('edu with the month used up → 429 quota_exceeded + Retry-After header', async () => {
    planCode = 'edu';
    usageQuota.checkAndIncrement.mockResolvedValue({
      allowed: false,
      used: 20,
      limit: 20,
      remaining: 0,
      resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const res = await request(app.getHttpServer())
      .post('/deep-research/stream')
      .send({ question: 'What is res judicata?' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('quota_exceeded');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(3500);
  });

  it('rejects an unknown body field before anything else runs', async () => {
    planCode = 'pro';
    const res = await request(app.getHttpServer())
      .post('/deep-research/stream')
      .send({ question: 'What is res judicata?', organizationId: 'x' });
    expect(res.status).toBe(400);
    expect(usageQuota.checkAndIncrement).not.toHaveBeenCalled();
  });
});
