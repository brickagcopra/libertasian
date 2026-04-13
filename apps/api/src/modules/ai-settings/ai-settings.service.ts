import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationCenterService } from '../notifications/notification-center.service';
import { budgetAlertTemplate } from '../notifications/templates/budget-alert';

/** TTL for cached AI settings in Redis (5 minutes). */
const SETTINGS_CACHE_TTL = 300;

/** Redis key prefix for cached AI settings. */
const SETTINGS_CACHE_PREFIX = 'ai_settings:';

/** Redis key where the RAG service reads the monthly budget. */
const BUDGET_REDIS_KEY = 'llm:config:monthly_budget_usd';

/** Redis key where the RAG service reads the optional daily budget cap (§7.2). */
const DAILY_BUDGET_REDIS_KEY = 'llm:config:daily_budget_usd';

/** Redis hash key pattern for monthly LLM usage. */
const USAGE_KEY_PREFIX = 'llm:usage:';

/** Redis hash key pattern for daily LLM usage (written by RAG service). */
const DAILY_USAGE_KEY_PREFIX = 'llm:usage:daily:';

/** Redis keys for the global ingestion wall-clock window (§7.3). */
const INGESTION_WINDOW_START_KEY = 'ingestion:window:start_local';
const INGESTION_WINDOW_STOP_KEY = 'ingestion:window:stop_local';
const INGESTION_WINDOW_TZ_KEY = 'ingestion:window:timezone';

/** AI settings row keys that back the budget and window admin forms. */
const MONTHLY_BUDGET_SETTING_KEY = 'llm_monthly_budget_usd';
const DAILY_BUDGET_SETTING_KEY = 'llm_daily_budget_usd';
const INGESTION_WINDOW_SETTING_KEY = 'ingestion_window';

/** Redis keys to track which threshold alerts have already been sent this month. */
const ALERT_SENT_PREFIX = 'llm:alert_sent:';

export interface IngestionWindowValue {
  startLocal: string;
  stopLocal: string;
  timezone: string;
}

export interface UsageSummary {
  tokensIn: number;
  tokensOut: number;
  requestCount: number;
  estimatedCostUsd: number;
  budgetUsd: number;
  budgetRemainingUsd: number;
  utilizationPercent: number;
  month: string;
}

export interface DailyUsageSummary {
  tokensIn: number;
  tokensOut: number;
  requestCount: number;
  estimatedCostUsd: number;
  dailyBudgetUsd: number | null;
  day: string;
}

export interface BudgetSnapshot {
  monthlyCeiling: number;
  dailyCeiling: number | null;
  monthSpend: number;
  daySpend: number;
  monthUtilizationPercent: number;
  dayUtilizationPercent: number | null;
  month: string;
  day: string;
}

export interface LedgerMonthSummary {
  periodYearMonth: string;
  totalAmountUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalRequests: number;
}

export interface LedgerScopeSummary {
  scope: string;
  totalAmountUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalRequests: number;
}

export interface CreateLedgerEntryDto {
  periodYearMonth: string;
  periodDay?: string;
  scope: string;
  amountUsd: number;
  tokensIn?: number;
  tokensOut?: number;
  requestCount?: number;
  modelName?: string;
  modelRunId?: string;
}

@Injectable()
export class AiSettingsService implements OnModuleInit {
  private readonly logger = new Logger(AiSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    @Optional() @Inject(NotificationsService)
    private readonly notifications: NotificationsService | null,
    @Optional() @Inject(NotificationCenterService)
    private readonly notificationCenter: NotificationCenterService | null,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.syncBudgetToRedis();
    await this.syncIngestionWindowToRedis();
  }

  /** Read a single AI setting by key, with Redis caching. */
  async getSetting(key: string): Promise<{ key: string; value: unknown; description: string | null }> {
    const cacheKey = `${SETTINGS_CACHE_PREFIX}${key}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as { key: string; value: unknown; description: string | null };
    }

    const row = await this.prisma.aiSettings.findUnique({ where: { key } });
    if (!row) {
      return { key, value: null, description: null };
    }

    const result = { key: row.key, value: row.value, description: row.description };
    await this.redis.set(cacheKey, JSON.stringify(result), SETTINGS_CACHE_TTL);
    return result;
  }

  /** Read all AI settings. */
  async getAllSettings(): Promise<{ key: string; value: unknown; description: string | null; updatedAt: Date }[]> {
    const rows = await this.prisma.aiSettings.findMany({
      orderBy: { key: 'asc' },
    });
    return rows.map((r: { key: string; value: unknown; description: string | null; updatedAt: Date }) => ({
      key: r.key,
      value: r.value,
      description: r.description,
      updatedAt: r.updatedAt,
    }));
  }

  /** Update a setting, invalidate cache, sync budget if needed, and audit log. */
  async updateSetting(key: string, value: unknown, userId: string): Promise<void> {
    const existing = await this.prisma.aiSettings.findUnique({ where: { key } });
    const oldValue = existing?.value;

    await this.prisma.aiSettings.upsert({
      where: { key },
      update: { value: value as object, updatedBy: userId },
      create: { key, value: value as object, updatedBy: userId },
    });

    // Invalidate cache
    await this.redis.del(`${SETTINGS_CACHE_PREFIX}${key}`);

    // If budget changed, sync to Redis for RAG service
    if (key === MONTHLY_BUDGET_SETTING_KEY || key === DAILY_BUDGET_SETTING_KEY) {
      await this.syncBudgetToRedis();
    }

    // If ingestion window changed, sync to Redis for the scheduler
    if (key === INGESTION_WINDOW_SETTING_KEY) {
      await this.syncIngestionWindowToRedis();
    }

    await this.audit.log({
      actorUserId: userId,
      actorType: 'admin',
      action: 'ai_settings.update',
      entityType: 'ai_settings',
      entityId: key,
      metadata: { key, oldValue: oldValue ?? null, newValue: value },
    });

    this.logger.log(`AI setting updated: ${key} by user ${userId}`);
  }

  /**
   * Sync both the monthly and daily budget ceilings from the DB to the Redis
   * keys the RAG service reads. If the daily setting row is missing or its
   * amount is null, the daily Redis key is DELETED (meaning "no daily cap").
   */
  async syncBudgetToRedis(): Promise<void> {
    try {
      const [monthlySetting, dailySetting] = await Promise.all([
        this.prisma.aiSettings.findUnique({ where: { key: MONTHLY_BUDGET_SETTING_KEY } }),
        this.prisma.aiSettings.findUnique({ where: { key: DAILY_BUDGET_SETTING_KEY } }),
      ]);

      const monthlyAmount = extractAmount(monthlySetting?.value);
      if (monthlyAmount !== null) {
        await this.redis.set(BUDGET_REDIS_KEY, String(monthlyAmount));
        this.logger.log(`Monthly budget synced to Redis: $${monthlyAmount}`);
      }

      const dailyAmount = extractAmount(dailySetting?.value);
      if (dailyAmount !== null) {
        await this.redis.set(DAILY_BUDGET_REDIS_KEY, String(dailyAmount));
        this.logger.log(`Daily budget synced to Redis: $${dailyAmount}`);
      } else {
        await this.redis.del(DAILY_BUDGET_REDIS_KEY);
      }
    } catch (err) {
      this.logger.error('Failed to sync budget to Redis', err);
    }
  }

  /**
   * Sync the global ingestion wall-clock window from the DB to the three
   * Redis keys the scheduler reads. Null/missing fields DELETE the
   * corresponding Redis keys so the scheduler reverts to its default
   * cron-only behavior.
   */
  async syncIngestionWindowToRedis(): Promise<void> {
    try {
      const setting = await this.prisma.aiSettings.findUnique({
        where: { key: INGESTION_WINDOW_SETTING_KEY },
      });

      const window = extractIngestionWindow(setting?.value);
      if (window === null) {
        await Promise.all([
          this.redis.del(INGESTION_WINDOW_START_KEY),
          this.redis.del(INGESTION_WINDOW_STOP_KEY),
          this.redis.del(INGESTION_WINDOW_TZ_KEY),
        ]);
        return;
      }

      await Promise.all([
        this.redis.set(INGESTION_WINDOW_START_KEY, window.startLocal),
        this.redis.set(INGESTION_WINDOW_STOP_KEY, window.stopLocal),
        this.redis.set(INGESTION_WINDOW_TZ_KEY, window.timezone),
      ]);
      this.logger.log(
        `Ingestion window synced to Redis: ${window.startLocal}–${window.stopLocal} ${window.timezone}`,
      );
    } catch (err) {
      this.logger.error('Failed to sync ingestion window to Redis', err);
    }
  }

  /**
   * Update the global LLM budget ceilings (monthly required, daily optional)
   * in a single admin action. Writes to `ai_settings`, syncs to Redis, and
   * writes an audit log entry capturing the diff of the changed fields.
   */
  async updateBudget(
    input: { monthlyBudgetUsd: number; dailyBudgetUsd?: number | null },
    userId: string,
  ): Promise<void> {
    const [monthlyExisting, dailyExisting] = await Promise.all([
      this.prisma.aiSettings.findUnique({ where: { key: MONTHLY_BUDGET_SETTING_KEY } }),
      this.prisma.aiSettings.findUnique({ where: { key: DAILY_BUDGET_SETTING_KEY } }),
    ]);

    const previousMonthly = extractAmount(monthlyExisting?.value);
    const previousDaily = extractAmount(dailyExisting?.value);

    await this.prisma.aiSettings.upsert({
      where: { key: MONTHLY_BUDGET_SETTING_KEY },
      update: {
        value: { amount: input.monthlyBudgetUsd, currency: 'USD' } as object,
        updatedBy: userId,
      },
      create: {
        key: MONTHLY_BUDGET_SETTING_KEY,
        value: { amount: input.monthlyBudgetUsd, currency: 'USD' } as object,
        updatedBy: userId,
      },
    });

    if (input.dailyBudgetUsd === undefined) {
      // Leave daily unchanged.
    } else if (input.dailyBudgetUsd === null) {
      // Explicit clear — delete the daily setting row so the Redis key is
      // dropped by the next sync and the RAG service treats daily as unset.
      if (dailyExisting) {
        await this.prisma.aiSettings.delete({ where: { key: DAILY_BUDGET_SETTING_KEY } });
      }
    } else {
      await this.prisma.aiSettings.upsert({
        where: { key: DAILY_BUDGET_SETTING_KEY },
        update: {
          value: { amount: input.dailyBudgetUsd, currency: 'USD' } as object,
          updatedBy: userId,
        },
        create: {
          key: DAILY_BUDGET_SETTING_KEY,
          value: { amount: input.dailyBudgetUsd, currency: 'USD' } as object,
          updatedBy: userId,
        },
      });
    }

    await this.redis.del(`${SETTINGS_CACHE_PREFIX}${MONTHLY_BUDGET_SETTING_KEY}`);
    await this.redis.del(`${SETTINGS_CACHE_PREFIX}${DAILY_BUDGET_SETTING_KEY}`);

    await this.syncBudgetToRedis();

    await this.audit.log({
      actorUserId: userId,
      actorType: 'admin',
      action: 'update_budget_or_window',
      entityType: 'ai_settings',
      entityId: MONTHLY_BUDGET_SETTING_KEY,
      metadata: {
        changed: 'budget',
        monthly: { old: previousMonthly, new: input.monthlyBudgetUsd },
        daily:
          input.dailyBudgetUsd === undefined
            ? { old: previousDaily, new: previousDaily, unchanged: true }
            : { old: previousDaily, new: input.dailyBudgetUsd },
      },
    });

    this.logger.log(
      `Budget updated by user ${userId}: monthly=$${input.monthlyBudgetUsd}` +
        (input.dailyBudgetUsd === undefined
          ? ''
          : ` daily=${input.dailyBudgetUsd === null ? 'null' : `$${input.dailyBudgetUsd}`}`),
    );
  }

  /**
   * Update the global ingestion wall-clock window. All three fields
   * (startLocal, stopLocal, timezone) move together — partial updates
   * are intentionally not supported by this method.
   */
  async updateIngestionWindow(
    input: IngestionWindowValue,
    userId: string,
  ): Promise<void> {
    const existing = await this.prisma.aiSettings.findUnique({
      where: { key: INGESTION_WINDOW_SETTING_KEY },
    });
    const previous = extractIngestionWindow(existing?.value);

    await this.prisma.aiSettings.upsert({
      where: { key: INGESTION_WINDOW_SETTING_KEY },
      update: { value: input as unknown as object, updatedBy: userId },
      create: {
        key: INGESTION_WINDOW_SETTING_KEY,
        value: input as unknown as object,
        updatedBy: userId,
      },
    });

    await this.redis.del(`${SETTINGS_CACHE_PREFIX}${INGESTION_WINDOW_SETTING_KEY}`);
    await this.syncIngestionWindowToRedis();

    await this.audit.log({
      actorUserId: userId,
      actorType: 'admin',
      action: 'update_budget_or_window',
      entityType: 'ai_settings',
      entityId: INGESTION_WINDOW_SETTING_KEY,
      metadata: {
        changed: 'ingestion_window',
        old: previous,
        new: input,
      },
    });

    this.logger.log(
      `Ingestion window updated by user ${userId}: ${input.startLocal}–${input.stopLocal} ${input.timezone}`,
    );
  }

  /** Get current month's LLM usage from Redis. */
  async getUsageSummary(month?: string): Promise<UsageSummary> {
    const targetMonth = month ?? this.currentMonth();
    const usageKey = `${USAGE_KEY_PREFIX}${targetMonth}`;

    const client = this.redis.getClient();
    const data = await client.hgetall(usageKey);

    const tokensIn = parseInt(data['tokens_in'] || '0', 10);
    const tokensOut = parseInt(data['tokens_out'] || '0', 10);
    const requestCount = parseInt(data['request_count'] || '0', 10);
    const estimatedCostUsd = parseFloat(data['estimated_cost_usd'] || '0');

    const budgetRaw = await this.redis.get(BUDGET_REDIS_KEY);
    const budgetUsd = budgetRaw ? parseFloat(budgetRaw) : 0;
    const budgetRemainingUsd = Math.max(0, budgetUsd - estimatedCostUsd);
    const utilizationPercent = budgetUsd > 0 ? (estimatedCostUsd / budgetUsd) * 100 : 0;

    return {
      tokensIn,
      tokensOut,
      requestCount,
      estimatedCostUsd: Math.round(estimatedCostUsd * 100) / 100,
      budgetUsd,
      budgetRemainingUsd: Math.round(budgetRemainingUsd * 100) / 100,
      utilizationPercent: Math.round(utilizationPercent * 10) / 10,
      month: targetMonth,
    };
  }

  /** Get usage history for the last N months. */
  async getUsageHistory(months: number = 12): Promise<UsageSummary[]> {
    const history: UsageSummary[] = [];
    const now = new Date();

    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const summary = await this.getUsageSummary(monthStr);
      history.push(summary);
    }

    return history;
  }

  /** Emergency reset of a month's usage counters. */
  async resetUsage(month: string, userId: string): Promise<void> {
    const usageKey = `${USAGE_KEY_PREFIX}${month}`;
    const client = this.redis.getClient();

    // Capture current values for audit
    const currentData = await client.hgetall(usageKey);

    await client.del(usageKey);

    await this.audit.log({
      actorUserId: userId,
      actorType: 'admin',
      action: 'ai_settings.usage_reset',
      entityType: 'ai_usage',
      entityId: month,
      metadata: { month, previousData: currentData },
    });

    this.logger.warn(`LLM usage reset for ${month} by user ${userId}`);
  }

  /**
   * Check budget thresholds and send notifications at 75%, 90%, and 100%.
   * Called periodically or after usage sync. Deduplicates alerts per month.
   */
  async checkBudgetThresholds(): Promise<void> {
    try {
      const usage = await this.getUsageSummary();
      if (usage.budgetUsd <= 0) return;

      const pct = usage.utilizationPercent;
      const month = this.currentMonth();

      const adminUsers = await this.prisma.user.findMany({
        where: {
          memberships: { some: { role: 'admin', status: 'active' } },
          status: 'active',
        },
        select: { id: true, email: true, fullName: true },
      });

      if (adminUsers.length === 0) return;

      const thresholds = [
        { level: 100, sendEmail: true },
        { level: 90, sendEmail: true },
        { level: 75, sendEmail: false },
      ];

      for (const threshold of thresholds) {
        if (pct < threshold.level) continue;

        const alertKey = `${ALERT_SENT_PREFIX}${month}:${threshold.level}`;
        const alreadySent = await this.redis.get(alertKey);
        if (alreadySent) continue;

        // Mark as sent (expire at end of month + buffer)
        await this.redis.set(alertKey, '1', 35 * 86400);

        const isPaused = threshold.level >= 100;
        const title = isPaused
          ? 'AI budget limit reached — features paused'
          : `AI budget at ${threshold.level}%`;
        const body = isPaused
          ? `Monthly spend of $${usage.estimatedCostUsd.toFixed(2)} has reached the $${usage.budgetUsd.toFixed(2)} limit. Increase the budget in AI Settings to resume.`
          : `AI budget is at ${pct.toFixed(0)}% ($${usage.estimatedCostUsd.toFixed(2)}/$${usage.budgetUsd.toFixed(2)}). Consider adjusting the limit.`;

        // In-app notifications for all admins
        if (this.notificationCenter) {
          for (const admin of adminUsers) {
            await this.notificationCenter.createNotification({
              userId: admin.id,
              type: 'budget_alert',
              title,
              body,
              entityType: 'ai_settings',
              entityId: 'llm_monthly_budget_usd',
            });
          }
        }

        // Email notifications at 90% and 100%
        if (threshold.sendEmail && this.notifications) {
          for (const admin of adminUsers) {
            const { subject, html } = budgetAlertTemplate({
              userName: admin.fullName,
              utilizationPercent: pct,
              currentSpend: `$${usage.estimatedCostUsd.toFixed(2)}`,
              budgetLimit: `$${usage.budgetUsd.toFixed(2)}`,
              isPaused,
            });

            // Use the announcement pipeline (respects email preferences)
            await this.notifications.sendAnnouncement({
              userIds: [admin.id],
              subject,
              title,
              content: html,
            });
          }
        }

        this.logger.warn(`Budget alert sent: ${threshold.level}% threshold (${pct.toFixed(1)}% actual)`);
        break; // Only send the highest applicable threshold
      }
    } catch (err) {
      this.logger.error('Failed to check budget thresholds', err);
    }
  }

  /** Get today's daily LLM usage from Redis. */
  async getDailyUsageSummary(day?: string): Promise<DailyUsageSummary> {
    const targetDay = day ?? this.currentDay();
    const usageKey = `${DAILY_USAGE_KEY_PREFIX}${targetDay}`;

    const client = this.redis.getClient();
    const data = await client.hgetall(usageKey);

    const tokensIn = parseInt(data['tokens_in'] || '0', 10);
    const tokensOut = parseInt(data['tokens_out'] || '0', 10);
    const requestCount = parseInt(data['request_count'] || '0', 10);
    const estimatedCostUsd = parseFloat(data['estimated_cost_usd'] || '0');

    const dailyBudgetRaw = await this.redis.get(DAILY_BUDGET_REDIS_KEY);
    const dailyBudgetUsd = dailyBudgetRaw ? parseFloat(dailyBudgetRaw) : null;

    return {
      tokensIn,
      tokensOut,
      requestCount,
      estimatedCostUsd: Math.round(estimatedCostUsd * 100) / 100,
      dailyBudgetUsd,
      day: targetDay,
    };
  }

  /** Consolidated snapshot for the budget admin page. */
  async getBudgetSnapshot(): Promise<BudgetSnapshot> {
    const month = this.currentMonth();
    const day = this.currentDay();

    const client = this.redis.getClient();
    const [monthlyBudgetRaw, dailyBudgetRaw, monthData, dayData] = await Promise.all([
      this.redis.get(BUDGET_REDIS_KEY),
      this.redis.get(DAILY_BUDGET_REDIS_KEY),
      client.hgetall(`${USAGE_KEY_PREFIX}${month}`),
      client.hgetall(`${DAILY_USAGE_KEY_PREFIX}${day}`),
    ]);

    const monthlyCeiling = monthlyBudgetRaw ? parseFloat(monthlyBudgetRaw) : 0;
    const dailyCeiling = dailyBudgetRaw ? parseFloat(dailyBudgetRaw) : null;
    const monthSpend = parseFloat(monthData['estimated_cost_usd'] || '0');
    const daySpend = parseFloat(dayData['estimated_cost_usd'] || '0');

    return {
      monthlyCeiling,
      dailyCeiling,
      monthSpend: Math.round(monthSpend * 100) / 100,
      daySpend: Math.round(daySpend * 100) / 100,
      monthUtilizationPercent:
        monthlyCeiling > 0 ? Math.round((monthSpend / monthlyCeiling) * 1000) / 10 : 0,
      dayUtilizationPercent:
        dailyCeiling !== null && dailyCeiling > 0
          ? Math.round((daySpend / dailyCeiling) * 1000) / 10
          : null,
      month,
      day,
    };
  }

  /** Ledger history grouped by month. */
  async getLedgerHistory(months: number = 12): Promise<LedgerMonthSummary[]> {
    const rows = await this.prisma.$queryRaw<
      {
        period_year_month: string;
        total_amount_usd: string;
        total_tokens_in: bigint;
        total_tokens_out: bigint;
        total_requests: bigint;
      }[]
    >`
      SELECT
        period_year_month,
        SUM(amount_usd)::text    AS total_amount_usd,
        SUM(tokens_in)           AS total_tokens_in,
        SUM(tokens_out)          AS total_tokens_out,
        SUM(request_count)       AS total_requests
      FROM budget_ledger
      GROUP BY period_year_month
      ORDER BY period_year_month DESC
      LIMIT ${months}
    `;

    return rows.map((r) => ({
      periodYearMonth: r.period_year_month,
      totalAmountUsd: parseFloat(r.total_amount_usd),
      totalTokensIn: Number(r.total_tokens_in),
      totalTokensOut: Number(r.total_tokens_out),
      totalRequests: Number(r.total_requests),
    }));
  }

  /** Ledger breakdown by scope for a given month. */
  async getLedgerByScope(periodYearMonth: string): Promise<LedgerScopeSummary[]> {
    const rows = await this.prisma.$queryRaw<
      {
        scope: string;
        total_amount_usd: string;
        total_tokens_in: bigint;
        total_tokens_out: bigint;
        total_requests: bigint;
      }[]
    >`
      SELECT
        scope,
        SUM(amount_usd)::text    AS total_amount_usd,
        SUM(tokens_in)           AS total_tokens_in,
        SUM(tokens_out)          AS total_tokens_out,
        SUM(request_count)       AS total_requests
      FROM budget_ledger
      WHERE period_year_month = ${periodYearMonth}
      GROUP BY scope
      ORDER BY SUM(amount_usd) DESC
    `;

    return rows.map((r) => ({
      scope: r.scope,
      totalAmountUsd: parseFloat(r.total_amount_usd),
      totalTokensIn: Number(r.total_tokens_in),
      totalTokensOut: Number(r.total_tokens_out),
      totalRequests: Number(r.total_requests),
    }));
  }

  /** Record a single ledger entry. */
  async recordLedgerEntry(entry: CreateLedgerEntryDto) {
    return this.prisma.budgetLedger.create({
      data: {
        periodYearMonth: entry.periodYearMonth,
        periodDay: entry.periodDay,
        scope: entry.scope,
        amountUsd: entry.amountUsd,
        tokensIn: entry.tokensIn ?? 0,
        tokensOut: entry.tokensOut ?? 0,
        requestCount: entry.requestCount ?? 1,
        modelName: entry.modelName,
        modelRunId: entry.modelRunId,
      },
    });
  }

  private currentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  private currentDay(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
}

/** Extract an `{amount: number}` value from a stored AiSettings JSON blob. */
function extractAmount(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const raw = (value as Record<string, unknown>)['amount'];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * Extract an `{startLocal, stopLocal, timezone}` value from a stored
 * AiSettings JSON blob. Returns null when any required field is missing.
 */
function extractIngestionWindow(value: unknown): IngestionWindowValue | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const startLocal = obj['startLocal'];
  const stopLocal = obj['stopLocal'];
  const timezone = obj['timezone'];
  if (
    typeof startLocal !== 'string' ||
    typeof stopLocal !== 'string' ||
    typeof timezone !== 'string'
  ) {
    return null;
  }
  return { startLocal, stopLocal, timezone };
}
