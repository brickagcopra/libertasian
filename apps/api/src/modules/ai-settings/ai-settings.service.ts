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

/** Redis hash key pattern for monthly LLM usage. */
const USAGE_KEY_PREFIX = 'llm:usage:';

/** Redis keys to track which threshold alerts have already been sent this month. */
const ALERT_SENT_PREFIX = 'llm:alert_sent:';

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
    if (key === 'llm_monthly_budget_usd') {
      await this.syncBudgetToRedis();
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

  /** Sync the monthly budget from DB to the Redis key the RAG service reads. */
  async syncBudgetToRedis(): Promise<void> {
    try {
      const setting = await this.prisma.aiSettings.findUnique({
        where: { key: 'llm_monthly_budget_usd' },
      });
      if (setting && typeof setting.value === 'object' && setting.value !== null) {
        const amount = (setting.value as Record<string, unknown>)['amount'];
        if (typeof amount === 'number') {
          await this.redis.set(BUDGET_REDIS_KEY, String(amount));
          this.logger.log(`Budget synced to Redis: $${amount}`);
        }
      }
    } catch (err) {
      this.logger.error('Failed to sync budget to Redis', err);
    }
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

  private currentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
