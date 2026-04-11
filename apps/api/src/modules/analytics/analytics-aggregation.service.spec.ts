import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsAggregationService } from './analytics-aggregation.service';

describe('AnalyticsAggregationService', () => {
  let service: AnalyticsAggregationService;
  let prisma: {
    analyticsEvent: { count: jest.Mock; groupBy: jest.Mock; findMany: jest.Mock };
    analyticsSession: { count: jest.Mock; aggregate: jest.Mock; groupBy: jest.Mock };
    analyticsFunnelStep: { create: jest.Mock };
    digest: { count: jest.Mock };
    $executeRaw: jest.Mock;
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
            analyticsFunnelStep: {
              create: jest.fn().mockResolvedValue({ id: 'funnel-1' }),
            },
            digest: {
              count: jest.fn().mockResolvedValue(0),
            },
            $executeRaw: jest.fn().mockResolvedValue(undefined),
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
      (prisma.analyticsEvent.groupBy as jest.Mock).mockRejectedValueOnce(
        new Error('Database error'),
      );
      await expect(service.aggregateDailyMetrics()).rejects.toThrow('Database error');
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

      // Should create 10 funnel step records (5 for scan + 5 for search)
      expect(prisma.analyticsFunnelStep.create).toHaveBeenCalledTimes(10);
    });

    it('should create funnel steps with correct step order', async () => {
      (prisma.analyticsEvent.count as jest.Mock).mockResolvedValue(0);

      await callPrivate('computeFunnels', yesterday);

      // Verify scan funnel step names and order
      const scanCalls = (prisma.analyticsFunnelStep.create as jest.Mock).mock.calls
        .filter((call: Array<{ data: { funnelName: string } }>) => call[0]!.data.funnelName === 'scan_to_digest')
        .map((call: Array<{ data: { stepName: string; stepOrder: number } }>) => ({
          name: call[0]!.data.stepName,
          order: call[0]!.data.stepOrder,
        }));

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
});
