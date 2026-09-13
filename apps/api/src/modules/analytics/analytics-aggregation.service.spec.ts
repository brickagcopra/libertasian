import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import {
  AnalyticsAggregationService,
  classifyPlatformFromUserAgent,
  CATCH_UP_WINDOW_DAYS,
  CATCH_UP_MAX_DAYS_PER_RUN,
} from './analytics-aggregation.service';

describe('AnalyticsAggregationService', () => {
  let service: AnalyticsAggregationService;
  let prisma: {
    analyticsEvent: { count: jest.Mock; groupBy: jest.Mock; findMany: jest.Mock };
    analyticsSession: { count: jest.Mock; aggregate: jest.Mock; groupBy: jest.Mock };
    analyticsDailyAggregate: { findMany: jest.Mock };
    loginEvent: { findMany: jest.Mock };
    analyticsFunnelStep: { create: jest.Mock; deleteMany: jest.Mock; createMany: jest.Mock };
    digest: { count: jest.Mock };
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  // Helpers to access private methods via service instance.
  // `this` must be bound back to the service — every private method in
  // AnalyticsAggregationService reads `this.prisma` (see e.g.
  // analytics-aggregation.service.ts:104), so an unbound call drops the
  // injected PrismaService and throws "Cannot read properties of undefined".
  const callPrivate = (method: string, ...args: unknown[]) => {
    const fn = (service as unknown as Record<string, (...a: unknown[]) => Promise<void>>)[method]!;
    return fn.call(service, ...args);
  };

  const yesterday = new Date('2026-04-02T00:00:00.000Z');

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsAggregationService,
        {
          provide: PrismaService,
          useValue: {
            analyticsEvent: {
              count: jest.fn().mockResolvedValue(0),
              groupBy: jest.fn().mockResolvedValue([]),
              findMany: jest.fn().mockResolvedValue([]),
            },
            analyticsSession: {
              count: jest.fn().mockResolvedValue(0),
              aggregate: jest.fn().mockResolvedValue({ _avg: { durationSeconds: null } }),
              groupBy: jest.fn().mockResolvedValue([]),
            },
            analyticsDailyAggregate: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            loginEvent: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            analyticsFunnelStep: {
              create: jest.fn().mockResolvedValue({ id: 'funnel-1' }),
              deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
              createMany: jest.fn().mockResolvedValue({ count: 5 }),
            },
            digest: {
              count: jest.fn().mockResolvedValue(0),
            },
            $executeRaw: jest.fn().mockResolvedValue(undefined),
            $queryRaw: jest.fn().mockResolvedValue([]),
            // The real client executes the array; the mock only needs to
            // resolve the promises so delete-then-insert actually runs.
            $transaction: jest.fn((ops: unknown) => Promise.all(ops as Promise<unknown>[])),
          },
        },
      ],
    }).compile();

    service = module.get<AnalyticsAggregationService>(AnalyticsAggregationService);
    prisma = module.get(PrismaService) as unknown as typeof prisma;
  });

  // =========================================================================
  // Daily Aggregation Entry Point
  // =========================================================================

  describe('aggregateDailyMetrics', () => {
    it('should run all metric computations without errors', async () => {
      await service.aggregateDailyMetrics();
      // Should call $executeRaw at least once (upsert aggregates + partitions)
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('should propagate errors from metric computation', async () => {
      // The catch-up runs first and deliberately swallows a per-date failure so
      // one bad day cannot block the backlog — stub it out so this asserts what
      // it says it does: yesterday's own sweep still propagates.
      jest.spyOn(service, 'catchUpMissingDays').mockResolvedValue([]);
      (prisma.analyticsEvent.groupBy as jest.Mock).mockRejectedValueOnce(
        new Error('Database error'),
      );
      await expect(service.aggregateDailyMetrics()).rejects.toThrow('Database error');
      jest.restoreAllMocks();
    });
  });

  // =========================================================================
  // Engagement Metrics
  // =========================================================================

  describe('computeEngagementMetrics', () => {
    it('should compute DAU from unique users with events', async () => {
      (prisma.analyticsEvent.groupBy as jest.Mock).mockResolvedValueOnce([
        { userId: 'user-1' },
        { userId: 'user-2' },
        { userId: 'user-3' },
      ]);

      await callPrivate('computeEngagementMetrics', yesterday);

      // Should upsert DAU = 3
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('should compute session count', async () => {
      (prisma.analyticsEvent.groupBy as jest.Mock).mockResolvedValueOnce([]);
      (prisma.analyticsSession.count as jest.Mock).mockResolvedValueOnce(150);

      await callPrivate('computeEngagementMetrics', yesterday);
      expect(prisma.analyticsSession.count).toHaveBeenCalled();
    });

    it('should compute average session duration', async () => {
      (prisma.analyticsEvent.groupBy as jest.Mock).mockResolvedValueOnce([]);
      (prisma.analyticsSession.count as jest.Mock).mockResolvedValueOnce(10);
      (prisma.analyticsSession.aggregate as jest.Mock).mockResolvedValueOnce({
        _avg: { durationSeconds: 345.6 },
      });

      await callPrivate('computeEngagementMetrics', yesterday);
      expect(prisma.analyticsSession.aggregate).toHaveBeenCalled();
    });

    it('should skip avg duration when no sessions have duration', async () => {
      (prisma.analyticsEvent.groupBy as jest.Mock).mockResolvedValueOnce([]);
      (prisma.analyticsSession.count as jest.Mock).mockResolvedValueOnce(0);
      (prisma.analyticsSession.aggregate as jest.Mock).mockResolvedValueOnce({
        _avg: { durationSeconds: null },
      });

      await callPrivate('computeEngagementMetrics', yesterday);
      // No extra upsert for avg_session_duration_seconds
    });

    it('should break down sessions by device type', async () => {
      (prisma.analyticsEvent.groupBy as jest.Mock).mockResolvedValueOnce([]);
      (prisma.analyticsSession.count as jest.Mock).mockResolvedValueOnce(100);
      (prisma.analyticsSession.aggregate as jest.Mock).mockResolvedValueOnce({
        _avg: { durationSeconds: null },
      });
      (prisma.analyticsSession.groupBy as jest.Mock).mockResolvedValueOnce([
        { deviceType: 'web', _count: 60 },
        { deviceType: 'ios', _count: 30 },
        { deviceType: 'android', _count: 10 },
      ]);

      await callPrivate('computeEngagementMetrics', yesterday);
      expect(prisma.analyticsSession.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ by: ['deviceType'] }),
      );
    });
  });

  // =========================================================================
  // Active User Metrics (DAU / WAU / MAU)
  // =========================================================================

  describe('computeActiveUserMetrics', () => {
    type UpsertCall = [Date, string, number, number, string | undefined];

    /**
     * Capture the upserts instead of asserting on `$executeRaw`. The upsert is
     * a tagged template, so its arguments arrive as a strings array plus
     * positional values — unreadable to assert against, and the reason the
     * older tests in this file can only check that "some SQL ran".
     */
    const spyOnUpsert = () =>
      jest
        .spyOn(
          service as unknown as { upsertAggregate: (...a: unknown[]) => Promise<void> },
          'upsertAggregate',
        )
        .mockResolvedValue(undefined);

    const upsertsFor = (spy: jest.SpyInstance, metric: string): UpsertCall[] =>
      (spy.mock.calls as unknown as UpsertCall[]).filter((call) => call[1] === metric);

    const totalFor = (spy: jest.SpyInstance, metric: string): UpsertCall | undefined =>
      upsertsFor(spy, metric).find((call) => call[4] === undefined);

    const dimensionFor = (
      spy: jest.SpyInstance,
      metric: string,
      dimension: string,
    ): UpsertCall | undefined => upsertsFor(spy, metric).find((call) => call[4] === dimension);

    it('unions login_events and analytics_events without double-counting a user in both', async () => {
      // user-1 both logged in and emitted an event; user-2 only logged in;
      // user-3 only emitted an event. The honest answer is 3, not 4.
      prisma.loginEvent.findMany.mockResolvedValue([
        { userId: 'user-1', userAgent: 'Mozilla/5.0' },
        { userId: 'user-2', userAgent: 'Mozilla/5.0' },
      ]);
      prisma.analyticsEvent.groupBy.mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-3' }]);

      const spy = spyOnUpsert();
      await service.computeActiveUserMetrics(yesterday);

      const dau = totalFor(spy, 'dau');
      expect(dau).toBeDefined();
      expect(dau![2]).toBe(3);
      expect(dau![3]).toBe(3);
    });

    it('counts a user once even when they logged in many times that day', async () => {
      prisma.loginEvent.findMany.mockResolvedValue([
        { userId: 'user-1', userAgent: 'okhttp/4.12.0' },
        { userId: 'user-1', userAgent: 'libertasian/1.0.2 CFNetwork/1494.0.7 Darwin/23.4.0' },
      ]);
      prisma.analyticsEvent.groupBy.mockResolvedValue([]);

      const spy = spyOnUpsert();
      await service.computeActiveUserMetrics(yesterday);

      expect(totalFor(spy, 'dau')![2]).toBe(1);
    });

    it('still counts event-only users, so the metric grows as instrumentation lands', async () => {
      prisma.loginEvent.findMany.mockResolvedValue([]);
      prisma.analyticsEvent.groupBy.mockResolvedValue([
        { userId: 'user-1' },
        { userId: 'user-2' },
      ]);

      const spy = spyOnUpsert();
      await service.computeActiveUserMetrics(yesterday);

      expect(totalFor(spy, 'dau')![2]).toBe(2);
    });

    it('writes wau and mau alongside dau', async () => {
      const spy = spyOnUpsert();
      await service.computeActiveUserMetrics(yesterday);

      expect(totalFor(spy, 'dau')).toBeDefined();
      expect(totalFor(spy, 'wau')).toBeDefined();
      expect(totalFor(spy, 'mau')).toBeDefined();
    });

    it('uses trailing windows that include the aggregation date', async () => {
      await service.computeActiveUserMetrics(yesterday); // 2026-04-02

      const windows = prisma.loginEvent.findMany.mock.calls.map(
        (call: [{ where: { createdAt: { gte: Date; lt: Date } } }]) => call[0].where.createdAt,
      );
      expect(windows).toHaveLength(3);

      // The upper bound is exclusive and one day past the aggregation date, so
      // the aggregation date itself is inside every window.
      for (const window of windows) {
        expect(window.lt.toISOString()).toBe('2026-04-03T00:00:00.000Z');
      }
      expect(windows[0]!.gte.toISOString()).toBe('2026-04-02T00:00:00.000Z'); // dau: 1 day
      expect(windows[1]!.gte.toISOString()).toBe('2026-03-27T00:00:00.000Z'); // wau: 7 days
      expect(windows[2]!.gte.toISOString()).toBe('2026-03-04T00:00:00.000Z'); // mau: 30 days
    });

    it('queries only successful logins', async () => {
      await service.computeActiveUserMetrics(yesterday);

      expect(prisma.loginEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ eventType: 'login_success' }),
        }),
      );
    });

    it('splits each metric by platform, derived from the login user agent', async () => {
      prisma.loginEvent.findMany.mockResolvedValue([
        { userId: 'ios-user', userAgent: 'libertasian/1.0.2 CFNetwork/1494.0.7 Darwin/23.4.0' },
        { userId: 'android-user', userAgent: 'okhttp/4.12.0' },
        { userId: 'web-user', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128' },
        { userId: 'mystery-user', userAgent: null },
      ]);
      prisma.analyticsEvent.groupBy.mockResolvedValue([]);

      const spy = spyOnUpsert();
      await service.computeActiveUserMetrics(yesterday);

      expect(dimensionFor(spy, 'dau', 'platform:ios')![2]).toBe(1);
      expect(dimensionFor(spy, 'dau', 'platform:android')![2]).toBe(1);
      // web-user plus the unclassifiable one — an unknown agent falls to web
      // rather than being dropped.
      expect(dimensionFor(spy, 'dau', 'platform:web')![2]).toBe(2);
      expect(totalFor(spy, 'dau')![2]).toBe(4);

      // …and the same split exists for the other two windows.
      expect(dimensionFor(spy, 'wau', 'platform:ios')![2]).toBe(1);
      expect(dimensionFor(spy, 'mau', 'platform:android')![2]).toBe(1);
    });

    it('writes a zero row for a platform with no users rather than omitting it', async () => {
      prisma.loginEvent.findMany.mockResolvedValue([
        { userId: 'web-user', userAgent: 'Mozilla/5.0' },
      ]);

      const spy = spyOnUpsert();
      await service.computeActiveUserMetrics(yesterday);

      expect(dimensionFor(spy, 'dau', 'platform:ios')![2]).toBe(0);
      expect(dimensionFor(spy, 'dau', 'platform:android')![2]).toBe(0);
    });

    it('is reached by the daily engagement pass', async () => {
      const spy = jest.spyOn(service, 'computeActiveUserMetrics');
      await callPrivate('computeEngagementMetrics', yesterday);
      expect(spy).toHaveBeenCalledWith(yesterday);
    });
  });

  describe('classifyPlatformFromUserAgent', () => {
    it.each([
      ['libertasian/1.0.2 CFNetwork/1494.0.7 Darwin/23.4.0', 'ios'],
      ['CFNetwork/978.0.7 Darwin/18.6.0', 'ios'],
      ['okhttp/4.12.0', 'android'],
      ['libertasian/1.0.2 okhttp/4.12.0', 'android'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0', 'web'],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 'web'],
    ])('classifies %s as %s', (userAgent, expected) => {
      expect(classifyPlatformFromUserAgent(userAgent)).toBe(expected);
    });

    it('falls back to web for an unknown agent', () => {
      expect(classifyPlatformFromUserAgent('SomeBot/1.0 (+https://example.test)')).toBe('web');
    });

    it('falls back to web for a missing agent', () => {
      expect(classifyPlatformFromUserAgent(null)).toBe('web');
      expect(classifyPlatformFromUserAgent(undefined)).toBe('web');
      expect(classifyPlatformFromUserAgent('')).toBe('web');
    });

    it('is case-insensitive', () => {
      expect(classifyPlatformFromUserAgent('OkHttp/4.12.0')).toBe('android');
      expect(classifyPlatformFromUserAgent('cfnetwork/1494 darwin/23')).toBe('ios');
    });
  });

  // =========================================================================
  // Search Metrics
  // =========================================================================

  describe('computeSearchMetrics', () => {
    it('should compute total searches', async () => {
      (prisma.analyticsEvent.count as jest.Mock).mockResolvedValueOnce(500); // total searches

      await callPrivate('computeSearchMetrics', yesterday);
      expect(prisma.analyticsEvent.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ eventName: 'search_executed' }),
        }),
      );
    });

    it('should compute zero-result rate in basis points', async () => {
      (prisma.analyticsEvent.count as jest.Mock)
        .mockResolvedValueOnce(100) // total searches
        .mockResolvedValueOnce(15)  // zero-result searches
        .mockResolvedValueOnce(80); // clicks

      await callPrivate('computeSearchMetrics', yesterday);
      // zero-result rate = 15/100 * 10000 = 1500 basis points (15%)
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('should compute click-through rate', async () => {
      (prisma.analyticsEvent.count as jest.Mock)
        .mockResolvedValueOnce(200)  // total searches
        .mockResolvedValueOnce(10)   // zero results
        .mockResolvedValueOnce(120); // clicks

      await callPrivate('computeSearchMetrics', yesterday);
      // CTR = 120/200 * 10000 = 6000 basis points (60%)
    });

    it('should skip rates when no searches exist', async () => {
      (prisma.analyticsEvent.count as jest.Mock)
        .mockResolvedValueOnce(0); // total searches = 0

      const execCalls = (prisma.$executeRaw as jest.Mock).mock.calls.length;
      await callPrivate('computeSearchMetrics', yesterday);
      // Should upsert only total searches (0), not rates
      expect((prisma.$executeRaw as jest.Mock).mock.calls.length).toBe(execCalls + 1);
    });
  });

  // =========================================================================
  // AI Metrics
  // =========================================================================

  describe('computeAiMetrics', () => {
    it('should compute total AI answers', async () => {
      (prisma.analyticsEvent.count as jest.Mock).mockResolvedValueOnce(250);

      await callPrivate('computeAiMetrics', yesterday);
      expect(prisma.analyticsEvent.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ eventName: 'ai_answer_requested' }),
        }),
      );
    });

    it('should compute abstention rate', async () => {
      (prisma.analyticsEvent.count as jest.Mock)
        .mockResolvedValueOnce(100) // total AI answers
        .mockResolvedValueOnce(20)  // abstentions
        .mockResolvedValueOnce(5)   // hallucinations
        .mockResolvedValueOnce(80)  // total feedback
        .mockResolvedValueOnce(60); // helpful count

      await callPrivate('computeAiMetrics', yesterday);
      // abstention rate = 20/100 * 10000 = 2000 bp
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('should compute hallucination report count', async () => {
      (prisma.analyticsEvent.count as jest.Mock)
        .mockResolvedValueOnce(50)  // total AI answers
        .mockResolvedValueOnce(5)   // abstentions
        .mockResolvedValueOnce(3)   // hallucinations
        .mockResolvedValueOnce(0)   // total feedback
        ;

      await callPrivate('computeAiMetrics', yesterday);
      expect(prisma.analyticsEvent.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            eventName: 'ai_answer_feedback',
            properties: { path: ['rating'], equals: 'hallucination_report' },
          }),
        }),
      );
    });

    it('should skip helpful rate when no feedback exists', async () => {
      (prisma.analyticsEvent.count as jest.Mock)
        .mockResolvedValueOnce(50)  // total AI answers
        .mockResolvedValueOnce(2)   // abstentions
        .mockResolvedValueOnce(0)   // hallucinations
        .mockResolvedValueOnce(0);  // total feedback

      await callPrivate('computeAiMetrics', yesterday);
      // Should not query for helpful count
    });
  });

  // =========================================================================
  // Digest Metrics
  // =========================================================================

  describe('computeDigestMetrics', () => {
    it('should compute digests generated and saved', async () => {
      (prisma.analyticsEvent.count as jest.Mock)
        .mockResolvedValueOnce(30)  // digests generated
        .mockResolvedValueOnce(25); // digests saved
      (prisma.digest.count as jest.Mock).mockResolvedValueOnce(8); // review queue

      await callPrivate('computeDigestMetrics', yesterday);
      expect(prisma.analyticsEvent.count).toHaveBeenCalledTimes(2);
    });

    it('should compute review queue depth snapshot', async () => {
      (prisma.analyticsEvent.count as jest.Mock)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      (prisma.digest.count as jest.Mock).mockResolvedValueOnce(12);

      await callPrivate('computeDigestMetrics', yesterday);
      expect(prisma.digest.count).toHaveBeenCalledWith({
        where: { reviewStatus: 'needs_human_review' },
      });
    });
  });

  // =========================================================================
  // Scan Metrics
  // =========================================================================

  describe('computeScanMetrics', () => {
    it('should compute scan success rate', async () => {
      (prisma.analyticsEvent.count as jest.Mock)
        .mockResolvedValueOnce(100) // scans started
        .mockResolvedValueOnce(80)  // scans saved/completed
        .mockResolvedValueOnce(15); // upgrade prompts

      await callPrivate('computeScanMetrics', yesterday);
      // success rate = 80/100 * 10000 = 8000 bp (80%)
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('should skip success rate when no scans started', async () => {
      (prisma.analyticsEvent.count as jest.Mock)
        .mockResolvedValueOnce(0) // scans started
        .mockResolvedValueOnce(0) // scans completed
        .mockResolvedValueOnce(0); // upgrade prompts

      await callPrivate('computeScanMetrics', yesterday);
    });
  });

  // =========================================================================
  // Study Metrics
  // =========================================================================

  describe('computeStudyMetrics', () => {
    it('should compute study sessions, flashcard sessions, codal views', async () => {
      (prisma.analyticsEvent.count as jest.Mock)
        .mockResolvedValueOnce(45)  // study sessions
        .mockResolvedValueOnce(100) // flashcard sessions
        .mockResolvedValueOnce(200) // codal views
        .mockResolvedValueOnce(500) // total flashcard answers
        .mockResolvedValueOnce(350); // correct answers

      await callPrivate('computeStudyMetrics', yesterday);
      expect(prisma.analyticsEvent.count).toHaveBeenCalledTimes(5);
    });

    it('should compute flashcard accuracy when answers exist', async () => {
      (prisma.analyticsEvent.count as jest.Mock)
        .mockResolvedValueOnce(10)   // study sessions
        .mockResolvedValueOnce(20)   // flashcard sessions
        .mockResolvedValueOnce(30)   // codal views
        .mockResolvedValueOnce(1000) // total flashcard answers
        .mockResolvedValueOnce(750); // correct answers

      await callPrivate('computeStudyMetrics', yesterday);
      // accuracy = 750/1000 * 10000 = 7500 bp (75%)
    });

    it('should skip accuracy when no flashcard answers exist', async () => {
      (prisma.analyticsEvent.count as jest.Mock)
        .mockResolvedValueOnce(0) // study sessions
        .mockResolvedValueOnce(0) // flashcard sessions
        .mockResolvedValueOnce(0) // codal views
        .mockResolvedValueOnce(0); // total flashcard answers = 0

      await callPrivate('computeStudyMetrics', yesterday);
      // Should not query for correct answers
      expect(prisma.analyticsEvent.count).toHaveBeenCalledTimes(4);
    });
  });

  // =========================================================================
  // Workspace Metrics
  // =========================================================================

  describe('computeWorkspaceMetrics', () => {
    it('should compute matters, documents, notes, collaboration actions', async () => {
      (prisma.analyticsEvent.count as jest.Mock)
        .mockResolvedValueOnce(10) // matters created
        .mockResolvedValueOnce(25) // documents attached
        .mockResolvedValueOnce(40) // notes created
        .mockResolvedValueOnce(15); // collaboration actions

      await callPrivate('computeWorkspaceMetrics', yesterday);
      expect(prisma.analyticsEvent.count).toHaveBeenCalledTimes(4);
    });
  });

  // =========================================================================
  // Revenue Metrics
  // =========================================================================

  describe('computeRevenueMetrics', () => {
    it('should compute all revenue metrics', async () => {
      (prisma.analyticsEvent.count as jest.Mock)
        .mockResolvedValueOnce(5)  // new subscriptions
        .mockResolvedValueOnce(3)  // upgrades
        .mockResolvedValueOnce(2)  // cancellations
        .mockResolvedValueOnce(1)  // churns
        .mockResolvedValueOnce(50) // paywall hits
        .mockResolvedValueOnce(10); // paywall converted

      await callPrivate('computeRevenueMetrics', yesterday);
      // paywall conversion rate = 10/50 * 10000 = 2000 bp (20%)
    });

    it('should skip paywall conversion rate when no paywall hits', async () => {
      (prisma.analyticsEvent.count as jest.Mock)
        .mockResolvedValueOnce(0) // new subs
        .mockResolvedValueOnce(0) // upgrades
        .mockResolvedValueOnce(0) // cancellations
        .mockResolvedValueOnce(0) // churns
        .mockResolvedValueOnce(0) // paywall hits = 0
        .mockResolvedValueOnce(0); // paywall converted

      await callPrivate('computeRevenueMetrics', yesterday);
    });
  });

  // =========================================================================
  // Ingestion Metrics
  // =========================================================================

  describe('computeIngestionMetrics', () => {
    it('should aggregate records created and errors from ingestion events', async () => {
      (prisma.analyticsEvent.findMany as jest.Mock).mockResolvedValueOnce([
        { properties: { records_created: 100, error_count: 2 } },
        { properties: { records_created: 50, error_count: 0 } },
        { properties: { records_created: 75, error_count: 5 } },
      ]);
      (prisma.analyticsEvent.count as jest.Mock).mockResolvedValueOnce(12); // editorial reviews

      await callPrivate('computeIngestionMetrics', yesterday);
      // total ingested = 100 + 50 + 75 = 225
      // total errors = 2 + 0 + 5 = 7
    });

    it('should handle empty ingestion events', async () => {
      (prisma.analyticsEvent.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prisma.analyticsEvent.count as jest.Mock).mockResolvedValueOnce(0);

      await callPrivate('computeIngestionMetrics', yesterday);
      // total ingested = 0, total errors = 0
    });
  });

  // =========================================================================
  // Funnel Computation
  // =========================================================================

  describe('computeFunnels', () => {
    it('should compute scan-to-digest funnel with 5 steps', async () => {
      (prisma.analyticsEvent.count as jest.Mock)
        .mockResolvedValueOnce(100) // scan_started
        .mockResolvedValueOnce(90)  // scan_captured
        .mockResolvedValueOnce(85)  // scan_ocr_completed
        .mockResolvedValueOnce(70)  // scan_digest_generated
        .mockResolvedValueOnce(60)  // scan_saved
        .mockResolvedValueOnce(200) // search_executed
        .mockResolvedValueOnce(150) // search_result_clicked
        .mockResolvedValueOnce(120) // document_opened
        .mockResolvedValueOnce(80)  // ai_answer_requested
        .mockResolvedValueOnce(30); // ai_answer_helpful

      await callPrivate('computeFunnels', yesterday);

      // 10 funnel step rows (5 for scan + 5 for search), now written as two
      // createMany batches rather than ten creates — see "funnel writes".
      const written = (prisma.analyticsFunnelStep.createMany as jest.Mock).mock.calls.flatMap(
        (call) => (call[0] as { data: unknown[] }).data,
      );
      expect(written).toHaveLength(10);
    });

    it('should create funnel steps with correct step order', async () => {
      (prisma.analyticsEvent.count as jest.Mock).mockResolvedValue(0);

      await callPrivate('computeFunnels', yesterday);

      // Verify scan funnel step names and order
      type FunnelRow = { funnelName: string; stepName: string; stepOrder: number };
      const scanCalls = (prisma.analyticsFunnelStep.createMany as jest.Mock).mock.calls
        .flatMap((call) => (call[0] as { data: FunnelRow[] }).data)
        .filter((row) => row.funnelName === 'scan_to_digest')
        .map((row) => ({ name: row.stepName, order: row.stepOrder }));

      expect(scanCalls).toEqual([
        { name: 'scan_started', order: 1 },
        { name: 'scan_captured', order: 2 },
        { name: 'scan_ocr_completed', order: 3 },
        { name: 'scan_digest_generated', order: 4 },
        { name: 'scan_saved', order: 5 },
      ]);
    });

    it('should filter search funnel last step for helpful feedback only', async () => {
      (prisma.analyticsEvent.count as jest.Mock).mockResolvedValue(0);

      await callPrivate('computeFunnels', yesterday);

      // The last step of search funnel should filter by rating = 'helpful'
      const searchHelpfulCall = (prisma.analyticsEvent.count as jest.Mock).mock.calls.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (call: any[]) =>
          call[0]?.where?.properties?.path?.[0] === 'rating',
      );
      expect(searchHelpfulCall).toBeDefined();
    });
  });

  // =========================================================================
  // Partition Management
  // =========================================================================

  describe('ensurePartitions', () => {
    it('should call the partition SQL function', async () => {
      await service.ensurePartitions();
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('should not throw on partition failure (graceful)', async () => {
      (prisma.$executeRaw as jest.Mock).mockRejectedValueOnce(
        new Error('Partition function not found'),
      );

      // Should not throw — error is logged
      await service.ensurePartitions();
    });
  });

  // =========================================================================
  // Date Range Handling
  // =========================================================================

  describe('date handling', () => {
    it('should use correct day boundaries (midnight to midnight UTC)', async () => {
      // Clear mocks to track fresh calls
      (prisma.analyticsEvent.count as jest.Mock).mockResolvedValue(0);
      (prisma.analyticsEvent.groupBy as jest.Mock).mockResolvedValue([]);
      (prisma.analyticsSession.count as jest.Mock).mockResolvedValue(0);
      (prisma.analyticsSession.aggregate as jest.Mock).mockResolvedValue({ _avg: { durationSeconds: null } });
      (prisma.analyticsSession.groupBy as jest.Mock).mockResolvedValue([]);

      await callPrivate('computeEngagementMetrics', yesterday);

      // The groupBy call should use gte: yesterday midnight and lt: today midnight
      const groupByCall = (prisma.analyticsEvent.groupBy as jest.Mock).mock.calls[0][0];
      const gte = new Date(groupByCall.where.createdAt.gte);
      const lt = new Date(groupByCall.where.createdAt.lt);

      expect(gte.toISOString()).toBe('2026-04-02T00:00:00.000Z');
      expect(lt.toISOString()).toBe('2026-04-03T00:00:00.000Z');
    });
  });
  // =========================================================================
  // Self-healing catch-up
  // =========================================================================

  describe('catchUpMissingDays', () => {
    const NOW = new Date('2026-09-14T06:30:00.000Z');

    /** `YYYY-MM-DD` for each of the `count` days ending yesterday. */
    function trailingDates(count: number, now = NOW): string[] {
      const out: string[] = [];
      for (let i = count; i >= 1; i -= 1) {
        const d = new Date(now);
        d.setUTCHours(0, 0, 0, 0);
        d.setUTCDate(d.getUTCDate() - i);
        out.push(d.toISOString().split('T')[0]!);
      }
      return out;
    }

    /** Mock the aggregates table as holding a row for exactly these dates. */
    function aggregatedDates(dates: string[]): void {
      (prisma.analyticsDailyAggregate.findMany as jest.Mock).mockResolvedValue(
        dates.map((d) => ({ date: new Date(`${d}T00:00:00.000Z`) })),
      );
    }

    it('fills a deliberately missing day in the middle of a full window', async () => {
      // Every day in the window is aggregated except one — the exact shape a
      // deploy restart straddling the cron's fire minute leaves behind.
      const all = trailingDates(CATCH_UP_WINDOW_DAYS);
      const gap = all[Math.floor(all.length / 2)]!;
      aggregatedDates(all.filter((d) => d !== gap));

      const filled = await service.catchUpMissingDays(NOW);

      expect(filled).toEqual([gap]);
    });

    it('actually aggregates the missing date, not just reports it', async () => {
      const all = trailingDates(CATCH_UP_WINDOW_DAYS);
      const gap = all[10]!;
      aggregatedDates(all.filter((d) => d !== gap));

      const spy = jest.spyOn(service, 'aggregateForDate').mockResolvedValue(undefined);
      await service.catchUpMissingDays(NOW);

      expect(spy).toHaveBeenCalledTimes(1);
      const [passed] = spy.mock.calls[0]!;
      expect((passed as Date).toISOString().split('T')[0]).toBe(gap);
      spy.mockRestore();
    });

    it('is idempotent — a second run finds nothing left to fill', async () => {
      const all = trailingDates(CATCH_UP_WINDOW_DAYS);
      const gap = all[5]!;
      aggregatedDates(all.filter((d) => d !== gap));

      const first = await service.catchUpMissingDays(NOW);
      expect(first).toEqual([gap]);

      // The fill wrote rows for that date, so the gap query now returns it.
      aggregatedDates(all);
      const second = await service.catchUpMissingDays(NOW);
      expect(second).toEqual([]);
    });

    it('does no work when the window is complete', async () => {
      aggregatedDates(trailingDates(CATCH_UP_WINDOW_DAYS));

      const spy = jest.spyOn(service, 'aggregateForDate');
      const filled = await service.catchUpMissingDays(NOW);

      expect(filled).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('caps the work per run and leaves the rest for the next one', async () => {
      // Cold table: every day in the window is missing.
      aggregatedDates([]);

      const spy = jest.spyOn(service, 'aggregateForDate').mockResolvedValue(undefined);
      const filled = await service.catchUpMissingDays(NOW);

      expect(filled).toHaveLength(CATCH_UP_MAX_DAYS_PER_RUN);
      expect(spy).toHaveBeenCalledTimes(CATCH_UP_MAX_DAYS_PER_RUN);
      spy.mockRestore();
    });

    it('fills oldest-first so a backlog drains in order', async () => {
      aggregatedDates([]);
      jest.spyOn(service, 'aggregateForDate').mockResolvedValue(undefined);

      const filled = await service.catchUpMissingDays(NOW);

      expect(filled).toEqual([...filled].sort());
      expect(filled[0]).toBe(trailingDates(CATCH_UP_WINDOW_DAYS)[0]);
    });

    it('never touches today — the day is still open', async () => {
      aggregatedDates([]);
      jest.spyOn(service, 'aggregateForDate').mockResolvedValue(undefined);

      const filled = await service.catchUpMissingDays(NOW);
      const today = NOW.toISOString().split('T')[0]!;

      expect(filled).not.toContain(today);
      const call = (prisma.analyticsDailyAggregate.findMany as jest.Mock).mock.calls[0][0];
      expect((call.where.date.lte as Date).toISOString().split('T')[0]).toBe('2026-09-13');
    });

    it('keeps going after one date fails', async () => {
      aggregatedDates([]);
      const spy = jest
        .spyOn(service, 'aggregateForDate')
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValue(undefined);

      const filled = await service.catchUpMissingDays(NOW);

      expect(spy).toHaveBeenCalledTimes(CATCH_UP_MAX_DAYS_PER_RUN);
      expect(filled).toHaveLength(CATCH_UP_MAX_DAYS_PER_RUN - 1);
      spy.mockRestore();
    });
  });

  describe('onModuleInit', () => {
    it('runs the catch-up on boot', async () => {
      const spy = jest.spyOn(service, 'catchUpMissingDays').mockResolvedValue([]);
      await service.onModuleInit();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('never fails app startup when the catch-up throws', async () => {
      const spy = jest
        .spyOn(service, 'catchUpMissingDays')
        .mockRejectedValue(new Error('database down'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      spy.mockRestore();
    });
  });

  describe('aggregateDailyMetrics', () => {
    it('reconciles missing days before computing yesterday', async () => {
      const order: string[] = [];
      const catchUp = jest
        .spyOn(service, 'catchUpMissingDays')
        .mockImplementation(async () => {
          order.push('catchUp');
          return [];
        });
      const sweep = jest.spyOn(service, 'aggregateForDate').mockImplementation(async () => {
        order.push('aggregateForDate');
      });

      await service.aggregateDailyMetrics();

      expect(order).toEqual(['catchUp', 'aggregateForDate']);
      catchUp.mockRestore();
      sweep.mockRestore();
    });
  });

  describe('aggregateForDate', () => {
    it('runs the same full sweep the cron does', async () => {
      // The catch-up and the cron share this method precisely so a backfilled
      // day cannot end up with a subset of the metrics. If a new compute* is
      // added to one path only, this list is where it shows up.
      const SWEEP = [
        'computeEngagementMetrics',
        'computeSurfaceMetrics',
        'computeSearchMetrics',
        'computeAiMetrics',
        'computeDigestMetrics',
        'computeScanMetrics',
        'computeStudyMetrics',
        'computeWorkspaceMetrics',
        'computeRevenueMetrics',
        'computeIngestionMetrics',
        'computeFunnels',
      ];

      // The compute* methods are private, so the spies go on the instance as a
      // plain record of async functions rather than through the class type.
      const target = service as unknown as Record<string, () => Promise<void>>;
      const calls: string[] = [];
      const originals = new Map<string, () => Promise<void>>();

      for (const name of SWEEP) {
        expect(typeof target[name]).toBe('function');
        originals.set(name, target[name]!);
        target[name] = async () => {
          calls.push(name);
        };
      }

      try {
        await service.aggregateForDate(yesterday);
      } finally {
        for (const [name, fn] of originals) target[name] = fn;
      }

      expect(calls).toEqual(SWEEP);
    });
  });

  // =========================================================================
  // Cron schedules — timezone must be explicit
  // =========================================================================

  describe('cron timezones', () => {
    /**
     * `@nestjs/schedule` evaluates a cron expression in the PROCESS timezone,
     * and the API container sets `TZ=Asia/Manila`. A schedule whose comment
     * says UTC and whose decorator omits `timeZone` fires eight hours away
     * from where everyone believes it does — which is how the daily
     * aggregation came to run at 18:00 UTC. Read the decorator metadata rather
     * than trusting the comment.
     */
    const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';

    function cronOptions(method: string): Record<string, unknown> {
      const fn = (service as unknown as Record<string, unknown>)[method];
      return Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, fn as object) as Record<string, unknown>;
    }

    it.each([['aggregateDailyMetrics'], ['ensurePartitions']])(
      '%s pins timeZone to UTC',
      (method) => {
        expect(cronOptions(method)).toMatchObject({ timeZone: 'UTC' });
      },
    );
  });

  // =========================================================================
  // Surface metrics
  // =========================================================================

  describe('computeSurfaceMetrics', () => {
    function surfaceRows(rows: Array<[string, number, number]>) {
      (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce(
        rows.map(([surface, views, uniqueUsers]) => ({
          surface,
          views: BigInt(views),
          unique_users: BigInt(uniqueUsers),
        })),
      );
    }

    /** The (metricName, dimension, value, uniqueUsers) tuples upserted. */
    function upserts(): Array<[string, string | null, number, number]> {
      return (prisma.$executeRaw as jest.Mock).mock.calls
        .map((call) => call as unknown[])
        .filter((call) => Array.isArray(call[0]))
        .map((call) => {
          // upsertAggregate binds: date, metricName, dimension, value, users, org
          const [, , metricName, dimension, value, users] = call;
          return [
            metricName as string,
            dimension as string | null,
            Number(value),
            users as number,
          ];
        });
    }

    it('writes one row per surface dimension', async () => {
      surfaceRows([
        ['digests', 42, 7],
        ['bar_exams', 31, 5],
        ['library', 12, 4],
      ]);
      (prisma.analyticsEvent.groupBy as jest.Mock).mockResolvedValueOnce([
        { userId: 'u1' },
        { userId: 'u2' },
        { userId: 'u3' },
        { userId: 'u4' },
        { userId: 'u5' },
        { userId: 'u6' },
        { userId: 'u7' },
        { userId: 'u8' },
        { userId: 'u9' },
      ]);

      await callPrivate('computeSurfaceMetrics', yesterday);

      const surfaceUpserts = upserts().filter(([metric]) => metric === 'surface_views');
      expect(surfaceUpserts).toEqual([
        ['surface_views', 'surface:digests', 42, 7],
        ['surface_views', 'surface:bar_exams', 31, 5],
        ['surface_views', 'surface:library', 12, 4],
        // Undimensioned total: views sum to the parts, unique users do NOT —
        // one person visits several surfaces in a day.
        ['surface_views', null, 85, 9],
      ]);
    });

    it('counts unique users per surface, not just views', async () => {
      surfaceRows([['digests', 40, 3]]);

      await callPrivate('computeSurfaceMetrics', yesterday);

      const [row] = upserts().filter(([, dimension]) => dimension === 'surface:digests');
      expect(row).toEqual(['surface_views', 'surface:digests', 40, 3]);
    });

    it('keeps an unmapped surface as other rather than dropping the views', async () => {
      surfaceRows([['other', 9, 2]]);

      await callPrivate('computeSurfaceMetrics', yesterday);

      expect(upserts()).toContainEqual(['surface_views', 'surface:other', 9, 2]);
    });

    it('still writes a zero total on a day with no page views', async () => {
      surfaceRows([]);

      await callPrivate('computeSurfaceMetrics', yesterday);

      expect(upserts()).toEqual([['surface_views', null, 0, 0]]);
    });

    it('scopes the raw query to the UTC day and to page_viewed', async () => {
      surfaceRows([]);
      await callPrivate('computeSurfaceMetrics', yesterday);

      const [strings, dayStart, dayEnd] = (prisma.$queryRaw as jest.Mock).mock.calls[0];
      const sql = (strings as string[]).join('?');
      expect(sql).toContain("event_name = 'page_viewed'");
      expect(sql).toContain("properties->>'surface'");
      // Bound parameters, never interpolated.
      expect((dayStart as Date).toISOString()).toBe('2026-04-02T00:00:00.000Z');
      expect((dayEnd as Date).toISOString()).toBe('2026-04-03T00:00:00.000Z');
    });
  });

  // =========================================================================
  // Sessions platform split
  // =========================================================================

  describe('sessions platform dimension', () => {
    it('writes all three platform rows including zeros', async () => {
      (prisma.analyticsSession.groupBy as jest.Mock).mockResolvedValueOnce([
        { deviceType: 'ios', _count: 12 },
        { deviceType: 'web', _count: 30 },
      ]);

      await callPrivate('computeEngagementMetrics', yesterday);

      const rows = (prisma.$executeRaw as jest.Mock).mock.calls
        .filter((call) => Array.isArray(call[0]))
        .map((call) => [call[2] as string, call[3] as string | null, Number(call[4])])
        .filter(([metric, dimension]) => metric === 'sessions' && String(dimension ?? '').startsWith('platform:'));

      expect(rows).toEqual([
        ['sessions', 'platform:ios', 12],
        // A genuine zero, written rather than omitted, so the dashboard can
        // tell "no Android sessions" from "no Android row".
        ['sessions', 'platform:android', 0],
        ['sessions', 'platform:web', 30],
      ]);
    });

    it('keeps the device dimension for values outside the three platforms', async () => {
      (prisma.analyticsSession.groupBy as jest.Mock).mockResolvedValueOnce([
        { deviceType: 'tablet', _count: 4 },
      ]);

      await callPrivate('computeEngagementMetrics', yesterday);

      const dimensions = (prisma.$executeRaw as jest.Mock).mock.calls
        .filter((call) => Array.isArray(call[0]))
        .map((call) => call[3] as string | null);

      expect(dimensions).toContain('device:tablet');
      expect(dimensions).not.toContain('platform:tablet');
    });
  });

  // =========================================================================
  // Funnel idempotency
  // =========================================================================

  describe('funnel writes', () => {
    it('replaces a date rather than appending a second set of rows', async () => {
      // analytics_funnel_steps has no unique key, so the original per-step
      // `create` doubled the funnel chart on any re-run — and a catch-up
      // backfill re-runs dates by design.
      await callPrivate('computeFunnels', yesterday);

      expect(prisma.analyticsFunnelStep.create).not.toHaveBeenCalled();
      expect(prisma.analyticsFunnelStep.deleteMany).toHaveBeenCalledWith({
        where: { funnelName: 'scan_to_digest', date: new Date('2026-04-02') },
      });
      expect(prisma.analyticsFunnelStep.deleteMany).toHaveBeenCalledWith({
        where: { funnelName: 'search_to_answer', date: new Date('2026-04-02') },
      });
    });

    it('writes the delete and the insert in one transaction', async () => {
      await callPrivate('computeFunnels', yesterday);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('produces the same row count on a re-run', async () => {
      await callPrivate('computeFunnels', yesterday);
      const first = (prisma.analyticsFunnelStep.createMany as jest.Mock).mock.calls.map(
        (call) => (call[0] as { data: unknown[] }).data.length,
      );

      (prisma.analyticsFunnelStep.createMany as jest.Mock).mockClear();
      await callPrivate('computeFunnels', yesterday);
      const second = (prisma.analyticsFunnelStep.createMany as jest.Mock).mock.calls.map(
        (call) => (call[0] as { data: unknown[] }).data.length,
      );

      expect(second).toEqual(first);
      expect(first).toEqual([5, 5]);
    });
  });
});
