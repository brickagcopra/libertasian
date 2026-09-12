import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { AuditService } from '../audit/audit.service';
import { AiSettingsService } from './ai-settings.service';

describe('AiSettingsService — budget and ingestion window sync', () => {
  let service: AiSettingsService;
  let prisma: { aiSettings: { findUnique: jest.Mock; upsert: jest.Mock; delete: jest.Mock } };
  let redis: { set: jest.Mock; del: jest.Mock; get: jest.Mock; getClient: jest.Mock };
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = {
      aiSettings: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    redis = {
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockResolvedValue(null),
      getClient: jest.fn(),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiSettingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get(AiSettingsService);
  });

  describe('syncBudgetToRedis', () => {
    it('writes both monthly and daily keys when both are set', async () => {
      prisma.aiSettings.findUnique
        .mockResolvedValueOnce({ key: 'llm_monthly_budget_usd', value: { amount: 200, currency: 'USD' } })
        .mockResolvedValueOnce({ key: 'llm_daily_budget_usd', value: { amount: 15, currency: 'USD' } });

      await service.syncBudgetToRedis();

      expect(redis.set).toHaveBeenCalledWith('llm:config:monthly_budget_usd', '200');
      expect(redis.set).toHaveBeenCalledWith('llm:config:daily_budget_usd', '15');
      expect(redis.del).not.toHaveBeenCalledWith('llm:config:daily_budget_usd');
    });

    it('deletes the daily key when the daily setting row is missing', async () => {
      prisma.aiSettings.findUnique
        .mockResolvedValueOnce({ key: 'llm_monthly_budget_usd', value: { amount: 200, currency: 'USD' } })
        .mockResolvedValueOnce(null);

      await service.syncBudgetToRedis();

      expect(redis.set).toHaveBeenCalledWith('llm:config:monthly_budget_usd', '200');
      expect(redis.del).toHaveBeenCalledWith('llm:config:daily_budget_usd');
    });

    it('deletes the daily key when the daily amount is malformed', async () => {
      prisma.aiSettings.findUnique
        .mockResolvedValueOnce({ key: 'llm_monthly_budget_usd', value: { amount: 200, currency: 'USD' } })
        .mockResolvedValueOnce({ key: 'llm_daily_budget_usd', value: {} });

      await service.syncBudgetToRedis();

      expect(redis.del).toHaveBeenCalledWith('llm:config:daily_budget_usd');
    });

    it('no-ops the monthly write when the monthly setting row is missing', async () => {
      prisma.aiSettings.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      await service.syncBudgetToRedis();

      expect(redis.set).not.toHaveBeenCalledWith('llm:config:monthly_budget_usd', expect.anything());
      expect(redis.del).toHaveBeenCalledWith('llm:config:daily_budget_usd');
    });
  });

  describe('syncBudgetToRedis — per-category ceilings', () => {
    /** monthly row, daily row, then the per-scope row. */
    function settingsRows(perScope: unknown) {
      prisma.aiSettings.findUnique
        .mockResolvedValueOnce({
          key: 'llm_monthly_budget_usd',
          value: { amount: 500, currency: 'USD' },
        })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          perScope === undefined
            ? null
            : { key: 'llm_budget_by_scope', value: perScope },
        );
    }

    it('fans out a configured scope to its own Redis keys', async () => {
      settingsRows({
        case_digest: { monthlyUsd: 5, dailyUsd: 1 },
        flashcard: { monthlyUsd: 20, dailyUsd: null },
      });

      await service.syncBudgetToRedis();

      expect(redis.set).toHaveBeenCalledWith(
        'llm:config:monthly_budget_usd:case_digest',
        '5',
      );
      expect(redis.set).toHaveBeenCalledWith(
        'llm:config:daily_budget_usd:case_digest',
        '1',
      );
      expect(redis.set).toHaveBeenCalledWith(
        'llm:config:monthly_budget_usd:flashcard',
        '20',
      );
      // No daily cap for flashcards — the key must be removed, not left.
      expect(redis.del).toHaveBeenCalledWith(
        'llm:config:daily_budget_usd:flashcard',
      );
      // The global ceiling is untouched by any of this.
      expect(redis.set).toHaveBeenCalledWith(
        'llm:config:monthly_budget_usd',
        '500',
      );
    });

    it('deletes the keys of a scope that is no longer configured', async () => {
      // A lifted cap must actually be lifted: if the Redis key survived,
      // rag-service would keep 503-ing that category forever.
      settingsRows({ flashcard: { monthlyUsd: 20, dailyUsd: null } });

      await service.syncBudgetToRedis();

      expect(redis.del).toHaveBeenCalledWith(
        'llm:config:monthly_budget_usd:case_digest',
      );
      expect(redis.del).toHaveBeenCalledWith(
        'llm:config:daily_budget_usd:case_digest',
      );
      expect(redis.set).not.toHaveBeenCalledWith(
        'llm:config:monthly_budget_usd:case_digest',
        expect.anything(),
      );
    });

    it('drops unknown scopes and malformed entries rather than throwing', async () => {
      settingsRows({
        not_a_real_scope: { monthlyUsd: 5 },
        mcq_question: { monthlyUsd: 'lots' },
        essay_prompt: { monthlyUsd: 3 },
      });

      await service.syncBudgetToRedis();

      expect(redis.set).toHaveBeenCalledWith(
        'llm:config:monthly_budget_usd:essay_prompt',
        '3',
      );
      expect(redis.set).not.toHaveBeenCalledWith(
        'llm:config:monthly_budget_usd:mcq_question',
        expect.anything(),
      );
      expect(redis.set).not.toHaveBeenCalledWith(
        'llm:config:monthly_budget_usd:not_a_real_scope',
        expect.anything(),
      );
    });

    it('treats a zero ceiling as unset', async () => {
      settingsRows({ flashcard: { monthlyUsd: 0, dailyUsd: null } });

      await service.syncBudgetToRedis();

      expect(redis.del).toHaveBeenCalledWith(
        'llm:config:monthly_budget_usd:flashcard',
      );
    });
  });

  describe('updateBudget — per-category ceilings', () => {
    it('merges one category without disturbing the others', async () => {
      prisma.aiSettings.findUnique
        // updateBudget's own monthly/daily reads
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        // getBudgetByScope
        .mockResolvedValueOnce({
          key: 'llm_budget_by_scope',
          value: {
            case_digest: { monthlyUsd: 5, dailyUsd: null },
            flashcard: { monthlyUsd: 20, dailyUsd: null },
          },
        });

      await service.updateBudget(
        { perScope: { case_digest: { monthlyUsd: 50, dailyUsd: 2 } } },
        'user-1',
      );

      const call = prisma.aiSettings.upsert.mock.calls.find(
        (c) => c[0].where.key === 'llm_budget_by_scope',
      );
      expect(call).toBeDefined();
      expect(call![0].update.value).toEqual({
        case_digest: { monthlyUsd: 50, dailyUsd: 2 },
        flashcard: { monthlyUsd: 20, dailyUsd: null },
      });
    });

    it('a null entry clears that category back to the global ceiling', async () => {
      prisma.aiSettings.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          key: 'llm_budget_by_scope',
          value: { case_digest: { monthlyUsd: 5, dailyUsd: null } },
        });

      await service.updateBudget({ perScope: { case_digest: null } }, 'user-1');

      const call = prisma.aiSettings.upsert.mock.calls.find(
        (c) => c[0].where.key === 'llm_budget_by_scope',
      );
      expect(call![0].update.value).toEqual({});
    });

    it('does not touch the global monthly row when only perScope is sent', async () => {
      // The old unconditional upsert wrote `{ amount: undefined }` here,
      // which reads back as "no ceiling" — an omitted field silently
      // removed the global cap.
      prisma.aiSettings.findUnique
        .mockResolvedValueOnce({
          key: 'llm_monthly_budget_usd',
          value: { amount: 50 },
        })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      await service.updateBudget(
        { perScope: { flashcard: { monthlyUsd: 5, dailyUsd: null } } },
        'user-1',
      );

      const monthlyUpsert = prisma.aiSettings.upsert.mock.calls.find(
        (c) => c[0].where.key === 'llm_monthly_budget_usd',
      );
      expect(monthlyUpsert).toBeUndefined();
    });
  });

  describe('getScopeBudgetStatus', () => {
    it('reports spend from Redis, which is what actually gates generation', async () => {
      prisma.aiSettings.findUnique.mockResolvedValueOnce({
        key: 'llm_budget_by_scope',
        value: { case_digest: { monthlyUsd: 5, dailyUsd: null } },
      });
      const hgetall = jest.fn().mockImplementation((key: string) =>
        key.endsWith(':case_digest') && key.startsWith('llm:usage:2')
          ? Promise.resolve({ estimated_cost_usd: '5.0100' })
          : Promise.resolve({}),
      );
      redis.getClient.mockReturnValue({ hgetall });

      const rows = await service.getScopeBudgetStatus();
      const digest = rows.find((r) => r.scope === 'case_digest');

      expect(digest).toMatchObject({
        monthlyUsd: 5,
        monthSpend: 5.01,
        monthRemaining: 0,
        stopped: true,
      });

      // A category with no ceiling is never reported as stopped.
      const flashcard = rows.find((r) => r.scope === 'flashcard');
      expect(flashcard).toMatchObject({ monthlyUsd: 0, stopped: false });
    });
  });

  describe('syncIngestionWindowToRedis', () => {
    it('writes all three window keys when the setting is present', async () => {
      prisma.aiSettings.findUnique.mockResolvedValue({
        key: 'ingestion_window',
        value: { startLocal: '02:00', stopLocal: '06:00', timezone: 'Asia/Manila' },
      });

      await service.syncIngestionWindowToRedis();

      expect(redis.set).toHaveBeenCalledWith('ingestion:window:start_local', '02:00');
      expect(redis.set).toHaveBeenCalledWith('ingestion:window:stop_local', '06:00');
      expect(redis.set).toHaveBeenCalledWith('ingestion:window:timezone', 'Asia/Manila');
    });

    it('deletes all three window keys when the setting row is missing', async () => {
      prisma.aiSettings.findUnique.mockResolvedValue(null);

      await service.syncIngestionWindowToRedis();

      expect(redis.del).toHaveBeenCalledWith('ingestion:window:start_local');
      expect(redis.del).toHaveBeenCalledWith('ingestion:window:stop_local');
      expect(redis.del).toHaveBeenCalledWith('ingestion:window:timezone');
    });
  });

  describe('updateBudget', () => {
    it('upserts monthly, upserts daily, syncs redis, and audits', async () => {
      prisma.aiSettings.findUnique
        // initial lookups for previous values inside updateBudget
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        // lookups triggered by the internal syncBudgetToRedis call
        .mockResolvedValueOnce({ key: 'llm_monthly_budget_usd', value: { amount: 300 } })
        .mockResolvedValueOnce({ key: 'llm_daily_budget_usd', value: { amount: 25 } });

      await service.updateBudget({ monthlyBudgetUsd: 300, dailyBudgetUsd: 25 }, 'user-1');

      expect(prisma.aiSettings.upsert).toHaveBeenCalledTimes(2);
      expect(redis.set).toHaveBeenCalledWith('llm:config:monthly_budget_usd', '300');
      expect(redis.set).toHaveBeenCalledWith('llm:config:daily_budget_usd', '25');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'user-1',
          action: 'update_budget_or_window',
          entityType: 'ai_settings',
          entityId: 'llm_monthly_budget_usd',
        }),
      );
    });

    it('deletes the daily setting row when dailyBudgetUsd is explicitly null', async () => {
      prisma.aiSettings.findUnique
        .mockResolvedValueOnce({ key: 'llm_monthly_budget_usd', value: { amount: 200 } })
        .mockResolvedValueOnce({ key: 'llm_daily_budget_usd', value: { amount: 10 } })
        .mockResolvedValueOnce({ key: 'llm_monthly_budget_usd', value: { amount: 300 } })
        .mockResolvedValueOnce(null);

      await service.updateBudget({ monthlyBudgetUsd: 300, dailyBudgetUsd: null }, 'user-1');

      expect(prisma.aiSettings.delete).toHaveBeenCalledWith({
        where: { key: 'llm_daily_budget_usd' },
      });
      expect(redis.del).toHaveBeenCalledWith('llm:config:daily_budget_usd');
    });

    it('leaves daily untouched when dailyBudgetUsd is undefined', async () => {
      prisma.aiSettings.findUnique
        .mockResolvedValueOnce({ key: 'llm_monthly_budget_usd', value: { amount: 200 } })
        .mockResolvedValueOnce({ key: 'llm_daily_budget_usd', value: { amount: 10 } })
        .mockResolvedValueOnce({ key: 'llm_monthly_budget_usd', value: { amount: 500 } })
        .mockResolvedValueOnce({ key: 'llm_daily_budget_usd', value: { amount: 10 } });

      await service.updateBudget({ monthlyBudgetUsd: 500 }, 'user-1');

      expect(prisma.aiSettings.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.aiSettings.delete).not.toHaveBeenCalled();
    });
  });

  describe('updateIngestionWindow', () => {
    it('upserts the window setting, syncs redis, and audits', async () => {
      prisma.aiSettings.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          key: 'ingestion_window',
          value: { startLocal: '02:00', stopLocal: '06:00', timezone: 'Asia/Manila' },
        });

      await service.updateIngestionWindow(
        { startLocal: '02:00', stopLocal: '06:00', timezone: 'Asia/Manila' },
        'user-1',
      );

      expect(prisma.aiSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: 'ingestion_window' } }),
      );
      expect(redis.set).toHaveBeenCalledWith('ingestion:window:start_local', '02:00');
      expect(redis.set).toHaveBeenCalledWith('ingestion:window:stop_local', '06:00');
      expect(redis.set).toHaveBeenCalledWith('ingestion:window:timezone', 'Asia/Manila');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update_budget_or_window',
          entityType: 'ai_settings',
          entityId: 'ingestion_window',
        }),
      );
    });
  });
});
