import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { AiSettingsService } from '../ai-settings/ai-settings.service';
import { IngestionSchedulerService } from './ingestion-scheduler.service';

/**
 * Unit tests for {@link IngestionSchedulerService}.
 *
 * Covers:
 * - Global ingestion_schedule disabled → no jobs created.
 * - Global enabled + per-source disabled → no jobs created for that source.
 * - Cron match + enabled → job created with both sourceId AND sourceEndpointId.
 * - Lookup uses SourceEndpoint.parserType (regression test for the fuzzy
 *   domain/name matcher that silently dropped `supreme_court_elibrary`).
 * - Budget exceeded → no jobs created regardless of schedule.
 * - Duplicate pending/running job → skip (no duplicate create).
 */
describe('IngestionSchedulerService', () => {
  let service: IngestionSchedulerService;
  let prisma: jest.Mocked<PrismaService>;
  let redis: jest.Mocked<RedisService>;
  let aiSettings: jest.Mocked<AiSettingsService>;

  // A frozen "now" that matches cron "0 2 * * *" (02:00 every day).
  // Constructed in LOCAL time because the scheduler uses Date.getHours() etc.,
  // not UTC accessors. If we passed an ISO string with a Z suffix, the test
  // would be flaky depending on the CI box timezone.
  const NOW = new Date(2026, 3, 10, 2, 0, 0); // April 10, 2026 02:00 local

  const mockEndpoint = {
    id: 'ep-sc-1',
    sourceId: 'src-sc',
    parserType: 'supreme_court_elibrary',
    status: 'active',
    source: {
      id: 'src-sc',
      name: 'Supreme Court E-Library',
      enabled: true,
    },
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IngestionSchedulerService,
        {
          provide: PrismaService,
          useValue: {
            sourceEndpoint: {
              findFirst: jest.fn(),
            },
            ingestionJob: {
              findFirst: jest.fn(),
              create: jest.fn(),
            },
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            getClient: jest.fn().mockReturnValue({
              hget: jest.fn().mockResolvedValue(null),
            }),
          },
        },
        {
          provide: AiSettingsService,
          useValue: {
            getSetting: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<IngestionSchedulerService>(IngestionSchedulerService);
    prisma = module.get(PrismaService);
    redis = module.get(RedisService);
    aiSettings = module.get(AiSettingsService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ─── Happy path ──────────────────────────────────────────────────────

  it('creates an ingestion job when cron matches and source is enabled', async () => {
    aiSettings.getSetting.mockResolvedValue({
      key: 'ingestion_schedule',
      value: {
        enabled: true,
        schedules: [
          { sourceKey: 'supreme_court_elibrary', cron: '0 2 * * *', enabled: true },
        ],
      },
    } as never);

    (prisma.sourceEndpoint.findFirst as jest.Mock).mockResolvedValue(mockEndpoint);
    (prisma.ingestionJob.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.ingestionJob.create as jest.Mock).mockResolvedValue({ id: 'job-1' });

    await service.checkSchedules();

    // Regression: uses parserType — NOT fuzzy domain/name lookup.
    expect(prisma.sourceEndpoint.findFirst).toHaveBeenCalledWith({
      where: {
        parserType: 'supreme_court_elibrary',
        status: 'active',
        source: { enabled: true },
      },
      include: { source: true },
    });

    // Must populate BOTH sourceId and sourceEndpointId on the new job.
    expect(prisma.ingestionJob.create).toHaveBeenCalledWith({
      data: {
        sourceId: 'src-sc',
        sourceEndpointId: 'ep-sc-1',
        jobType: 'fetch',
        status: 'pending',
        triggerType: 'scheduled',
        startedAt: expect.any(Date),
      },
    });
  });

  // ─── Disabled paths ──────────────────────────────────────────────────

  it('creates no jobs when the global flag is disabled', async () => {
    aiSettings.getSetting.mockResolvedValue({
      key: 'ingestion_schedule',
      value: {
        enabled: false,
        schedules: [
          { sourceKey: 'supreme_court_elibrary', cron: '0 2 * * *', enabled: true },
        ],
      },
    } as never);

    await service.checkSchedules();

    expect(prisma.sourceEndpoint.findFirst).not.toHaveBeenCalled();
    expect(prisma.ingestionJob.create).not.toHaveBeenCalled();
  });

  it('skips individual source entries that are disabled', async () => {
    aiSettings.getSetting.mockResolvedValue({
      key: 'ingestion_schedule',
      value: {
        enabled: true,
        schedules: [
          { sourceKey: 'supreme_court_elibrary', cron: '0 2 * * *', enabled: false },
          { sourceKey: 'lawphil', cron: '0 3 * * *', enabled: true },
        ],
      },
    } as never);

    await service.checkSchedules();

    // lawphil cron '0 3 * * *' does NOT match 02:00 → nothing matches at all.
    expect(prisma.sourceEndpoint.findFirst).not.toHaveBeenCalled();
    expect(prisma.ingestionJob.create).not.toHaveBeenCalled();
  });

  // ─── Budget gate ─────────────────────────────────────────────────────

  it('creates no jobs when the LLM budget is exceeded', async () => {
    aiSettings.getSetting.mockResolvedValue({
      key: 'ingestion_schedule',
      value: {
        enabled: true,
        schedules: [
          { sourceKey: 'supreme_court_elibrary', cron: '0 2 * * *', enabled: true },
        ],
      },
    } as never);

    (redis.get as jest.Mock).mockResolvedValue('10.0'); // budget = $10
    const mockClient = { hget: jest.fn().mockResolvedValue('15.0') }; // spent = $15
    (redis.getClient as jest.Mock).mockReturnValue(mockClient);

    await service.checkSchedules();

    expect(prisma.sourceEndpoint.findFirst).not.toHaveBeenCalled();
    expect(prisma.ingestionJob.create).not.toHaveBeenCalled();
  });

  // ─── Regression: parser_type lookup ─────────────────────────────────

  it('logs a warning and skips when no matching SourceEndpoint exists', async () => {
    aiSettings.getSetting.mockResolvedValue({
      key: 'ingestion_schedule',
      value: {
        enabled: true,
        schedules: [
          { sourceKey: 'supreme_court_elibrary', cron: '0 2 * * *', enabled: true },
        ],
      },
    } as never);

    (prisma.sourceEndpoint.findFirst as jest.Mock).mockResolvedValue(null);

    await service.checkSchedules();

    expect(prisma.sourceEndpoint.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.ingestionJob.create).not.toHaveBeenCalled();
  });

  // ─── Duplicate suppression ───────────────────────────────────────────

  it('skips when a pending/running job already exists for the endpoint', async () => {
    aiSettings.getSetting.mockResolvedValue({
      key: 'ingestion_schedule',
      value: {
        enabled: true,
        schedules: [
          { sourceKey: 'supreme_court_elibrary', cron: '0 2 * * *', enabled: true },
        ],
      },
    } as never);

    (prisma.sourceEndpoint.findFirst as jest.Mock).mockResolvedValue(mockEndpoint);
    (prisma.ingestionJob.findFirst as jest.Mock).mockResolvedValue({
      id: 'existing-job',
      status: 'pending',
    });

    await service.checkSchedules();

    expect(prisma.ingestionJob.findFirst).toHaveBeenCalledWith({
      where: {
        sourceId: 'src-sc',
        sourceEndpointId: 'ep-sc-1',
        status: { in: ['pending', 'running'] },
      },
    });
    expect(prisma.ingestionJob.create).not.toHaveBeenCalled();
  });

  // ─── cronMatchesNow: step + range + comma-separated forms ──────────
  // Exercises '*/30 8-18 * * *' and '0 9,12,15 * * *' — the Option A
  // prod schedule introduced field forms not covered by the fixtures above.
  // Observed indirectly via checkSchedules(): on a cron match, the service
  // proceeds to sourceEndpoint.findFirst; on a miss, it short-circuits.

  it.each([
    ['*/30 8-18 * * *', new Date(2026, 3, 10, 9, 30, 0), true],  // step minute + hour in range
    ['*/30 8-18 * * *', new Date(2026, 3, 10, 7, 0, 0), false],  // hour below range
    ['0 9,12,15 * * *', new Date(2026, 3, 10, 12, 0, 0), true],  // middle value in list
    ['0 9,12,15 * * *', new Date(2026, 3, 10, 10, 0, 0), false], // hour not in list
  ] as const)('cronMatchesNow handles %s at %s → match=%s', async (cron, when, shouldMatch) => {
    jest.setSystemTime(when);
    aiSettings.getSetting.mockResolvedValue({
      key: 'ingestion_schedule',
      value: { enabled: true, schedules: [{ sourceKey: 'supreme_court_elibrary', cron, enabled: true }] },
    } as never);
    (prisma.sourceEndpoint.findFirst as jest.Mock).mockResolvedValue(mockEndpoint);
    (prisma.ingestionJob.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.ingestionJob.create as jest.Mock).mockResolvedValue({ id: 'job-1' });

    await service.checkSchedules();

    expect(prisma.sourceEndpoint.findFirst).toHaveBeenCalledTimes(shouldMatch ? 1 : 0);
  });

  // ─── No-config path ──────────────────────────────────────────────────

  it('exits cleanly when the ingestion_schedule setting has no value', async () => {
    aiSettings.getSetting.mockResolvedValue({
      key: 'ingestion_schedule',
      value: null,
    } as never);

    await service.checkSchedules();

    expect(prisma.sourceEndpoint.findFirst).not.toHaveBeenCalled();
    expect(prisma.ingestionJob.create).not.toHaveBeenCalled();
  });
});
