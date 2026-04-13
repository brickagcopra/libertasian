import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { AuditService } from '../audit/audit.service';
import { AiSettingsService } from './ai-settings.service';

describe('AiSettingsService — budget snapshot, daily usage, and ledger', () => {
  let service: AiSettingsService;
  let prisma: {
    aiSettings: { findUnique: jest.Mock; upsert: jest.Mock; delete: jest.Mock };
    budgetLedger: { create: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let redis: {
    set: jest.Mock;
    del: jest.Mock;
    get: jest.Mock;
    getClient: jest.Mock;
  };
  let audit: { log: jest.Mock };
  let hgetall: jest.Mock;

  beforeEach(async () => {
    hgetall = jest.fn().mockResolvedValue({});
    prisma = {
      aiSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      budgetLedger: {
        create: jest.fn().mockResolvedValue({ id: 'ledger-1' }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    redis = {
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockResolvedValue(null),
      getClient: jest.fn().mockReturnValue({ hgetall }),
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

  // ---- syncBudgetToRedis (daily-focused) ----

  describe('syncBudgetToRedis — daily budget sync', () => {
    it('writes daily budget to Redis when the setting exists', async () => {
      prisma.aiSettings.findUnique
        .mockResolvedValueOnce({ key: 'llm_monthly_budget_usd', value: { amount: 200, currency: 'USD' } })
        .mockResolvedValueOnce({ key: 'llm_daily_budget_usd', value: { amount: 15, currency: 'USD' } });

      await service.syncBudgetToRedis();

      expect(redis.set).toHaveBeenCalledWith('llm:config:daily_budget_usd', '15');
    });

    it('deletes the daily Redis key when the daily setting does not exist', async () => {
      prisma.aiSettings.findUnique
        .mockResolvedValueOnce({ key: 'llm_monthly_budget_usd', value: { amount: 200, currency: 'USD' } })
        .mockResolvedValueOnce(null);

      await service.syncBudgetToRedis();

      expect(redis.del).toHaveBeenCalledWith('llm:config:daily_budget_usd');
    });
  });

  // ---- getDailyUsageSummary ----

  describe('getDailyUsageSummary', () => {
    it('returns daily usage from Redis', async () => {
      hgetall.mockResolvedValue({
        tokens_in: '500',
        tokens_out: '200',
        request_count: '3',
        estimated_cost_usd: '0.045',
      });
      redis.get.mockResolvedValue('10');

      const result = await service.getDailyUsageSummary('2026-04-12');

      expect(result).toEqual({
        tokensIn: 500,
        tokensOut: 200,
        requestCount: 3,
        estimatedCostUsd: 0.05,
        dailyBudgetUsd: 10,
        day: '2026-04-12',
      });
    });

    it('returns zeros when no usage exists', async () => {
      hgetall.mockResolvedValue({});
      redis.get.mockResolvedValue(null);

      const result = await service.getDailyUsageSummary('2026-04-12');

      expect(result).toEqual({
        tokensIn: 0,
        tokensOut: 0,
        requestCount: 0,
        estimatedCostUsd: 0,
        dailyBudgetUsd: null,
        day: '2026-04-12',
      });
    });
  });

  // ---- getBudgetSnapshot ----

  describe('getBudgetSnapshot', () => {
    it('returns both monthly and daily data', async () => {
      redis.get
        .mockResolvedValueOnce('200')  // monthly budget
        .mockResolvedValueOnce('15');   // daily budget

      hgetall
        .mockResolvedValueOnce({ estimated_cost_usd: '50.00' })   // monthly usage
        .mockResolvedValueOnce({ estimated_cost_usd: '5.00' });   // daily usage

      const snapshot = await service.getBudgetSnapshot();

      expect(snapshot.monthlyCeiling).toBe(200);
      expect(snapshot.dailyCeiling).toBe(15);
      expect(snapshot.monthSpend).toBe(50);
      expect(snapshot.daySpend).toBe(5);
      expect(snapshot.monthUtilizationPercent).toBe(25);
      expect(snapshot.dayUtilizationPercent).toBeCloseTo(33.3, 0);
    });

    it('handles missing daily ceiling gracefully', async () => {
      redis.get
        .mockResolvedValueOnce('100')  // monthly budget
        .mockResolvedValueOnce(null);  // no daily budget

      hgetall
        .mockResolvedValueOnce({ estimated_cost_usd: '25.00' })
        .mockResolvedValueOnce({});

      const snapshot = await service.getBudgetSnapshot();

      expect(snapshot.dailyCeiling).toBeNull();
      expect(snapshot.dayUtilizationPercent).toBeNull();
      expect(snapshot.monthUtilizationPercent).toBe(25);
    });
  });

  // ---- getLedgerHistory ----

  describe('getLedgerHistory', () => {
    it('returns grouped monthly summaries', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          period_year_month: '2026-04',
          total_amount_usd: '12.345678',
          total_tokens_in: BigInt(5000),
          total_tokens_out: BigInt(2000),
          total_requests: BigInt(10),
        },
        {
          period_year_month: '2026-03',
          total_amount_usd: '8.100000',
          total_tokens_in: BigInt(3000),
          total_tokens_out: BigInt(1000),
          total_requests: BigInt(5),
        },
      ]);

      const history = await service.getLedgerHistory(12);

      expect(history).toEqual([
        {
          periodYearMonth: '2026-04',
          totalAmountUsd: 12.345678,
          totalTokensIn: 5000,
          totalTokensOut: 2000,
          totalRequests: 10,
        },
        {
          periodYearMonth: '2026-03',
          totalAmountUsd: 8.1,
          totalTokensIn: 3000,
          totalTokensOut: 1000,
          totalRequests: 5,
        },
      ]);
    });

    it('returns empty array when no entries', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const history = await service.getLedgerHistory(12);

      expect(history).toEqual([]);
    });
  });

  // ---- getLedgerByScope ----

  describe('getLedgerByScope', () => {
    it('returns per-scope breakdown', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          scope: 'global',
          total_amount_usd: '5.000000',
          total_tokens_in: BigInt(2000),
          total_tokens_out: BigInt(800),
          total_requests: BigInt(4),
        },
        {
          scope: 'backfill_batch:abc123',
          total_amount_usd: '3.500000',
          total_tokens_in: BigInt(1500),
          total_tokens_out: BigInt(600),
          total_requests: BigInt(3),
        },
      ]);

      const result = await service.getLedgerByScope('2026-04');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        scope: 'global',
        totalAmountUsd: 5,
        totalTokensIn: 2000,
        totalTokensOut: 800,
        totalRequests: 4,
      });
      expect(result[1]!.scope).toBe('backfill_batch:abc123');
    });
  });

  // ---- recordLedgerEntry ----

  describe('recordLedgerEntry', () => {
    it('creates a ledger row', async () => {
      const entry = {
        periodYearMonth: '2026-04',
        periodDay: '2026-04-12',
        scope: 'global',
        amountUsd: 0.0045,
        tokensIn: 500,
        tokensOut: 200,
        requestCount: 1,
        modelName: 'gpt-4o-mini',
        modelRunId: 'run-uuid-1',
      };

      await service.recordLedgerEntry(entry);

      expect(prisma.budgetLedger.create).toHaveBeenCalledWith({
        data: {
          periodYearMonth: '2026-04',
          periodDay: '2026-04-12',
          scope: 'global',
          amountUsd: 0.0045,
          tokensIn: 500,
          tokensOut: 200,
          requestCount: 1,
          modelName: 'gpt-4o-mini',
          modelRunId: 'run-uuid-1',
        },
      });
    });
  });

  // ---- updateBudget (settings update) ----

  describe('updateBudget — settings update', () => {
    it('updates monthly ceiling and syncs to Redis', async () => {
      prisma.aiSettings.findUnique
        .mockResolvedValueOnce({ key: 'llm_monthly_budget_usd', value: { amount: 100 } })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ key: 'llm_monthly_budget_usd', value: { amount: 300 } })
        .mockResolvedValueOnce(null);

      await service.updateBudget({ monthlyBudgetUsd: 300 }, 'user-1');

      expect(prisma.aiSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'llm_monthly_budget_usd' },
          update: expect.objectContaining({
            value: { amount: 300, currency: 'USD' },
          }),
        }),
      );
      expect(redis.set).toHaveBeenCalledWith('llm:config:monthly_budget_usd', '300');
    });

    it('updates daily ceiling and syncs to Redis', async () => {
      prisma.aiSettings.findUnique
        .mockResolvedValueOnce({ key: 'llm_monthly_budget_usd', value: { amount: 200 } })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ key: 'llm_monthly_budget_usd', value: { amount: 200 } })
        .mockResolvedValueOnce({ key: 'llm_daily_budget_usd', value: { amount: 20 } });

      await service.updateBudget({ monthlyBudgetUsd: 200, dailyBudgetUsd: 20 }, 'user-1');

      expect(prisma.aiSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'llm_daily_budget_usd' },
          update: expect.objectContaining({
            value: { amount: 20, currency: 'USD' },
          }),
        }),
      );
      expect(redis.set).toHaveBeenCalledWith('llm:config:daily_budget_usd', '20');
    });

    it('audit logs the change', async () => {
      prisma.aiSettings.findUnique
        .mockResolvedValueOnce({ key: 'llm_monthly_budget_usd', value: { amount: 100 } })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ key: 'llm_monthly_budget_usd', value: { amount: 500 } })
        .mockResolvedValueOnce(null);

      await service.updateBudget({ monthlyBudgetUsd: 500 }, 'user-admin');

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'user-admin',
          actorType: 'admin',
          action: 'update_budget_or_window',
          entityType: 'ai_settings',
          entityId: 'llm_monthly_budget_usd',
          metadata: expect.objectContaining({
            changed: 'budget',
            monthly: { old: 100, new: 500 },
          }),
        }),
      );
    });
  });
});
