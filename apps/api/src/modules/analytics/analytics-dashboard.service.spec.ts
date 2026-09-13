import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { AnalyticsDashboardService } from './analytics-dashboard.service';

/**
 * Prisma returns `AnalyticsDailyAggregate.metricValue` as a real `bigint`
 * (the column is `BigInt` in schema.prisma). This fixture used to declare it
 * as a JS number, so the suite never exercised `JSON.stringify` against a
 * BigInt and a ten-route 500 shipped green. Keep these literals `n`-suffixed.
 */
function aggregateRows() {
  return [
    {
      id: 'agg-1',
      metricName: 'dau',
      date: new Date('2026-04-01'),
      dimension: null,
      metricValue: 500n,
      uniqueUsers: 500,
      organizationId: null,
      createdAt: new Date('2026-04-02'),
    },
    {
      id: 'agg-2',
      metricName: 'searches',
      date: new Date('2026-04-01'),
      dimension: null,
      metricValue: 1200n,
      uniqueUsers: 0,
      organizationId: null,
      createdAt: new Date('2026-04-02'),
    },
    {
      id: 'agg-3',
      metricName: 'ai_answers',
      date: new Date('2026-04-01'),
      dimension: null,
      metricValue: 300n,
      uniqueUsers: 0,
      organizationId: null,
      createdAt: new Date('2026-04-02'),
    },
  ];
}

describe('AnalyticsDashboardService', () => {
  let service: AnalyticsDashboardService;
  let prisma: jest.Mocked<PrismaService>;
  let redis: jest.Mocked<RedisService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsDashboardService,
        {
          provide: PrismaService,
          useValue: {
            analyticsDailyAggregate: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            analyticsFunnelStep: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            analyticsRetentionCohort: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            analyticsEvent: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            analyticsSession: {
              count: jest.fn().mockResolvedValue(0),
            },
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue('OK'),
            getClient: jest.fn().mockReturnValue({
              hgetall: jest.fn().mockResolvedValue({}),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AnalyticsDashboardService>(AnalyticsDashboardService);
    prisma = module.get(PrismaService);
    redis = module.get(RedisService);
  });

  // =========================================================================
  // Overview
  // =========================================================================

  describe('getOverview', () => {
    it('should return overview metrics with date range', async () => {
      (prisma.analyticsDailyAggregate.findMany as jest.Mock).mockResolvedValueOnce(
        aggregateRows(),
      );

      const result = await service.getOverview({});
      expect(result).toHaveProperty('metrics');
      expect(result).toHaveProperty('dateRange');
      expect(result.metrics).toHaveLength(3);
    });

    it('should query correct metric names for overview', async () => {
      await service.getOverview({});
      expect(prisma.analyticsDailyAggregate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            metricName: { in: ['dau', 'wau', 'mau', 'ai_answers', 'searches', 'new_subscriptions'] },
          }),
        }),
      );
    });

    it('should default to 30-day range when no dates provided', async () => {
      await service.getOverview({});
      const call = (prisma.analyticsDailyAggregate.findMany as jest.Mock).mock.calls[0][0];
      const from = new Date(call.where.date.gte);
      const to = new Date(call.where.date.lte);
      const diffDays = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
      expect(diffDays).toBeGreaterThanOrEqual(29);
      expect(diffDays).toBeLessThanOrEqual(31);
    });

    it('should use custom date range when provided', async () => {
      await service.getOverview({ from: '2026-03-01', to: '2026-03-31' });
      const call = (prisma.analyticsDailyAggregate.findMany as jest.Mock).mock.calls[0][0];
      expect(new Date(call.where.date.gte).toISOString()).toContain('2026-03-01');
      expect(new Date(call.where.date.lte).toISOString()).toContain('2026-03-31');
    });

    it('should filter by organizationId when provided', async () => {
      await service.getOverview({ organizationId: 'org-1' });
      const call = (prisma.analyticsDailyAggregate.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where.organizationId).toBe('org-1');
    });
  });

  // =========================================================================
  // Caching
  // =========================================================================

  describe('caching', () => {
    it('should return cached data when available', async () => {
      const cachedData = JSON.stringify({ metrics: [{ metricName: 'dau', metricValue: 100 }], dateRange: {} });
      (redis.get as jest.Mock).mockResolvedValueOnce(cachedData);

      const result = await service.getOverview({});
      expect(result.metrics).toHaveLength(1);
      expect(prisma.analyticsDailyAggregate.findMany).not.toHaveBeenCalled();
    });

    it('should store results in cache after fetching from DB', async () => {
      (prisma.analyticsDailyAggregate.findMany as jest.Mock).mockResolvedValueOnce([]);

      await service.getOverview({});
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining('cache:analytics:dashboard:'),
        expect.any(String),
        300, // 5 min TTL
      );
    });

    it('should use different cache keys for different endpoints', async () => {
      await service.getOverview({});
      await service.getEngagement({});

      const setCalls = (redis.set as jest.Mock).mock.calls;
      expect(setCalls[0][0]).not.toBe(setCalls[1][0]);
    });

    it('should use different cache keys for different date ranges', async () => {
      await service.getOverview({ from: '2026-03-01', to: '2026-03-15' });
      await service.getOverview({ from: '2026-03-16', to: '2026-03-31' });

      const setCalls = (redis.set as jest.Mock).mock.calls;
      expect(setCalls[0][0]).not.toBe(setCalls[1][0]);
    });
  });

  // =========================================================================
  // Engagement
  // =========================================================================

  describe('getEngagement', () => {
    it('should query engagement-specific metrics', async () => {
      await service.getEngagement({});
      expect(prisma.analyticsDailyAggregate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            metricName: {
              in: ['dau', 'wau', 'mau', 'sessions', 'avg_session_duration_seconds', 'avg_events_per_session'],
            },
          }),
        }),
      );
    });
  });

  // =========================================================================
  // Search Metrics
  // =========================================================================

  describe('getSearchMetrics', () => {
    it('should query search-specific metrics', async () => {
      await service.getSearchMetrics({});
      const call = (prisma.analyticsDailyAggregate.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where.metricName.in).toContain('searches');
      expect(call.where.metricName.in).toContain('search_zero_result_rate');
      expect(call.where.metricName.in).toContain('search_click_through_rate');
    });
  });

  // =========================================================================
  // AI Metrics
  // =========================================================================

  describe('getAiMetrics', () => {
    it('should query AI-specific metrics', async () => {
      await service.getAiMetrics({});
      const call = (prisma.analyticsDailyAggregate.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where.metricName.in).toContain('ai_answers');
    });
  });

  // =========================================================================
  // Digest Metrics
  // =========================================================================

  describe('getDigestMetrics', () => {
    it('should query digest-specific metrics', async () => {
      await service.getDigestMetrics({});
      const call = (prisma.analyticsDailyAggregate.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where.metricName.in).toContain('digests_generated');
      expect(call.where.metricName.in).toContain('digests_saved');
    });
  });

  // =========================================================================
  // Funnel Data
  // =========================================================================

  describe('getFunnel', () => {
    it('should query funnel steps by name', async () => {
      (prisma.analyticsFunnelStep.findMany as jest.Mock).mockResolvedValueOnce([
        { funnelName: 'scan_to_digest', stepName: 'scan_started', stepOrder: 1, enteredCount: 100 },
        { funnelName: 'scan_to_digest', stepName: 'scan_captured', stepOrder: 2, enteredCount: 90 },
      ]);

      const result = await service.getFunnel('scan_to_digest', {});
      expect(prisma.analyticsFunnelStep.findMany).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Retention
  // =========================================================================

  describe('getRetention', () => {
    it('should query retention cohort data', async () => {
      (prisma.analyticsRetentionCohort.findMany as jest.Mock).mockResolvedValueOnce([
        { cohortWeek: '2026-03-01', retentionWeek: 0, userCount: 100, returningCount: 100, retentionRate: 10000 },
        { cohortWeek: '2026-03-01', retentionWeek: 1, userCount: 100, returningCount: 75, retentionRate: 7500 },
      ]);

      const result = await service.getRetention({});
      expect(prisma.analyticsRetentionCohort.findMany).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Order & Sorting
  // =========================================================================

  describe('query ordering', () => {
    it('should order aggregate results by date ascending', async () => {
      await service.getOverview({});
      const call = (prisma.analyticsDailyAggregate.findMany as jest.Mock).mock.calls[0][0];
      expect(call.orderBy).toEqual({ date: 'asc' });
    });
  });

  // =========================================================================
  // BigInt serialization
  //
  // metricValue is a Prisma BigInt. JSON.stringify throws
  // "TypeError: Do not know how to serialize a BigInt" on one, which 500s
  // every route below AND the Redis cache write in getCachedOrFetch.
  // queryAggregates converts once, at the single point where BigInt enters
  // the service; these tests hold that line.
  // =========================================================================

  describe('BigInt serialization', () => {
    /** Every endpoint that reads analytics_daily_aggregates. */
    const aggregateEndpoints: Array<[string, () => Promise<{ metrics: unknown[] }>]> = [
      ['overview', () => service.getOverview({})],
      ['engagement', () => service.getEngagement({})],
      ['search', () => service.getSearchMetrics({})],
      ['ai', () => service.getAiMetrics({})],
      ['digests', () => service.getDigestMetrics({})],
      ['scans', () => service.getScanMetrics({})],
      ['study', () => service.getStudyMetrics({})],
      ['workspace', () => service.getWorkspaceMetrics({})],
      ['revenue', () => service.getRevenueMetrics({})],
      ['ingestion', () => service.getIngestionMetrics({})],
    ];

    beforeEach(() => {
      (prisma.analyticsDailyAggregate.findMany as jest.Mock).mockResolvedValue(
        aggregateRows(),
      );
    });

    it('the fixture actually carries BigInt values', () => {
      // Guards the guard: if these stop being bigint, every assertion below
      // passes vacuously — which is exactly how the original bug shipped.
      expect(aggregateRows().every((r) => typeof r.metricValue === 'bigint')).toBe(true);
    });

    it.each(aggregateEndpoints)(
      '%s returns metricValue as a number, not a bigint',
      async (_name, call) => {
        const result = await call();

        expect(result.metrics).toHaveLength(3);
        for (const row of result.metrics as Array<{ metricValue: unknown }>) {
          expect(typeof row.metricValue).toBe('number');
        }
      },
    );

    it.each(aggregateEndpoints)('%s survives JSON.stringify', async (_name, call) => {
      const result = await call();
      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('preserves the numeric value through the conversion', async () => {
      const result = await service.getOverview({});
      const values = (result.metrics as Array<{ metricName: string; metricValue: number }>)
        .map((r) => [r.metricName, r.metricValue] as const);
      expect(values).toEqual([
        ['dau', 500],
        ['searches', 1200],
        ['ai_answers', 300],
      ]);
    });

    it('writes a serializable payload to the Redis cache', async () => {
      // getCachedOrFetch stringifies before SET — the BigInt threw here too,
      // so a green route with a poisoned cache write is not good enough.
      await service.getOverview({});

      const [, payload] = (redis.set as jest.Mock).mock.calls[0];
      expect(typeof payload).toBe('string');
      const parsed = JSON.parse(payload as string) as {
        metrics: Array<{ metricValue: unknown }>;
      };
      expect(parsed.metrics.map((r) => r.metricValue)).toEqual([500, 1200, 300]);
    });

    it('carries the full row through, not just the converted field', async () => {
      const result = await service.getOverview({});
      expect(result.metrics[0]).toEqual(
        expect.objectContaining({
          id: 'agg-1',
          metricName: 'dau',
          dimension: null,
          uniqueUsers: 500,
          organizationId: null,
        }),
      );
    });
  });
});
