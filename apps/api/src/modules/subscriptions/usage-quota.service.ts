import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import type { ClientPlatform } from '../../common/config/store-availability';
import type { SubscriptionEntitlements } from './subscriptions.service';
import { EntitlementService } from './entitlement.service';

export type QuotaType =
  | 'aiAnswers'
  | 'searchQueries'
  | 'digestsPerMonth'
  | 'cameraScansPerMonth'
  | 'memoDraftingPerMonth'
  | 'pleadingAssistancePerMonth'
  | 'caseComparisonPerMonth'
  | 'timelineGenerationPerMonth'
  | 'hearingPrepPerMonth'
  | 'contradictionDetectionPerMonth'
  | 'documentUploadsPerMonth';

export interface QuotaCheckResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
}

export interface QuotaCheckResultV2 extends QuotaCheckResult {
  baseLimit: number;
  bonusAmount: number;
}

export interface UsageSummaryV2 {
  quotas: Record<QuotaType, QuotaCheckResultV2>;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
}

const ALL_QUOTA_TYPES: QuotaType[] = [
  'aiAnswers',
  'searchQueries',
  'digestsPerMonth',
  'cameraScansPerMonth',
  'memoDraftingPerMonth',
  'pleadingAssistancePerMonth',
  'caseComparisonPerMonth',
  'timelineGenerationPerMonth',
  'hearingPrepPerMonth',
  'contradictionDetectionPerMonth',
  'documentUploadsPerMonth',
];

@Injectable()
export class UsageQuotaService {
  private readonly logger = new Logger(UsageQuotaService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly entitlementService: EntitlementService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Check the quota and increment usage if allowed.
   * Uses billing-cycle-aware Redis keys when a subscription has billing period dates.
   *
   * When `opts.isPlatformAdmin` is true, returns unlimited and skips the
   * Redis counter entirely — platform admins must not consume real-user
   * quota so a single admin scrolling the corpus cannot starve customers.
   * Callers are still expected to write an audit-log row for the bypass
   * (the guard does this; non-guarded call sites should pass the flag and
   * the controller can record manually if needed).
   */
  async checkAndIncrement(
    organizationId: string,
    userId: string,
    quotaType: QuotaType,
    opts?: { isPlatformAdmin?: boolean },
  ): Promise<QuotaCheckResult> {
    if (opts?.isPlatformAdmin) {
      return {
        allowed: true,
        used: 0,
        limit: -1,
        remaining: -1,
        resetsAt: '',
      };
    }

    const entitlements = await this.entitlementService.resolveEffectiveEntitlements(organizationId);
    const limit = this.getLimit(entitlements, quotaType);

    // -1 means unlimited
    if (limit === -1) {
      return {
        allowed: true,
        used: 0,
        limit: -1,
        remaining: -1,
        resetsAt: '',
      };
    }

    const billingPeriod = await this.getBillingPeriod(organizationId);
    const isMonthly = this.isMonthlyQuota(quotaType);
    const key = this.buildRedisKey(organizationId, userId, quotaType, isMonthly, billingPeriod);
    const ttl = this.computeTtl(isMonthly, billingPeriod);
    const resetsAt = this.computeResetsAt(isMonthly, billingPeriod);

    const current = await this.redis.get(key);
    const used = current ? parseInt(current, 10) : 0;

    if (used >= limit) {
      return {
        allowed: false,
        used,
        limit,
        remaining: 0,
        resetsAt,
      };
    }

    // Atomically seed the counter with its TTL on creation. No-op if the
    // key already exists (preserves existing TTL). Replaces the previous
    // non-atomic incr+expire pair, which could orphan a TTL-less key under
    // noeviction if the process crashed between the two commands.
    await this.redis.getClient().set(key, '0', 'EX', ttl, 'NX');
    const newCount = await this.redis.incr(key);

    return {
      allowed: true,
      used: newCount,
      limit,
      remaining: Math.max(0, limit - newCount),
      resetsAt,
    };
  }

  /**
   * Get current usage summary for all quota types (backward-compatible V1).
   * Wraps V2 and strips the new fields.
   */
  async getUsageSummary(
    organizationId: string,
    userId: string,
  ): Promise<Record<QuotaType, QuotaCheckResult>> {
    const v2 = await this.getUsageSummaryV2(organizationId, userId);
    const result = {} as Record<QuotaType, QuotaCheckResult>;

    for (const quotaType of ALL_QUOTA_TYPES) {
      const { baseLimit: _b, bonusAmount: _a, ...v1Fields } = v2.quotas[quotaType];
      result[quotaType] = v1Fields;
    }

    return result;
  }

  /**
   * V2 usage summary with baseLimit, bonusAmount, and billing period dates.
   */
  async getUsageSummaryV2(
    organizationId: string,
    userId: string,
    // Defaults to `null` = not enforced, so the callers that do not thread a
    // platform keep today's behaviour. Threaded by QuotaController so the
    // quota numbers agree with the `previewOnly` and `storePurchaseAvailable`
    // shipped in the same response.
    platform: ClientPlatform | null = null,
  ): Promise<UsageSummaryV2> {
    const [effective, base, billingPeriod] = await Promise.all([
      this.entitlementService.resolveEffectiveEntitlements(organizationId, platform),
      this.entitlementService.getBaseEntitlements(organizationId, platform),
      this.getBillingPeriod(organizationId),
    ]);

    const quotas = {} as Record<QuotaType, QuotaCheckResultV2>;

    for (const quotaType of ALL_QUOTA_TYPES) {
      const effectiveLimit = this.getLimit(effective, quotaType);
      const baseLimit = this.getLimit(base, quotaType);
      // Bonus is the difference between effective and base (only meaningful for numeric, non-unlimited)
      const bonusAmount =
        effectiveLimit === -1 || baseLimit === -1
          ? 0
          : Math.max(0, effectiveLimit - baseLimit);

      if (effectiveLimit === -1) {
        quotas[quotaType] = {
          allowed: true,
          used: 0,
          limit: -1,
          remaining: -1,
          resetsAt: '',
          baseLimit,
          bonusAmount: 0,
        };
        continue;
      }

      const isMonthly = this.isMonthlyQuota(quotaType);
      const key = this.buildRedisKey(organizationId, userId, quotaType, isMonthly, billingPeriod);
      const resetsAt = this.computeResetsAt(isMonthly, billingPeriod);

      const current = await this.redis.get(key);
      const used = current ? parseInt(current, 10) : 0;

      quotas[quotaType] = {
        allowed: used < effectiveLimit,
        used,
        limit: effectiveLimit,
        remaining: Math.max(0, effectiveLimit - used),
        resetsAt,
        baseLimit,
        bonusAmount,
      };
    }

    return {
      quotas,
      billingPeriodStart: billingPeriod?.start?.toISOString() ?? null,
      billingPeriodEnd: billingPeriod?.end?.toISOString() ?? null,
    };
  }

  /**
   * Invalidate entitlement cache when a new billing cycle starts.
   * New billing period = new Redis keys automatically (period-stamped keys).
   */
  async resetQuotasForBillingCycle(organizationId: string): Promise<void> {
    await this.entitlementService.invalidateEntitlementCache(organizationId);
  }

  // ---- Private helpers ----

  /**
   * Build a billing-cycle-aware Redis key.
   * If subscription has currentPeriodStart, monthly quotas use period-stamped keys.
   * Falls back to calendar-based keys for free users.
   */
  private buildRedisKey(
    organizationId: string,
    userId: string,
    quotaType: QuotaType,
    isMonthly: boolean,
    billingPeriod: BillingPeriodInfo | null,
  ): string {
    if (isMonthly && billingPeriod?.start) {
      const periodStart = this.formatDateKey(billingPeriod.start);
      return `quota:period:${organizationId}:${userId}:${quotaType}:${periodStart}`;
    }

    return isMonthly
      ? `quota:monthly:${organizationId}:${userId}:${quotaType}`
      : `quota:daily:${organizationId}:${userId}:${quotaType}`;
  }

  private computeTtl(
    isMonthly: boolean,
    billingPeriod: BillingPeriodInfo | null,
  ): number {
    if (isMonthly && billingPeriod?.end) {
      const now = new Date();
      return Math.max(1, Math.ceil((billingPeriod.end.getTime() - now.getTime()) / 1000));
    }

    return isMonthly ? this.secondsUntilEndOfMonth() : this.secondsUntilMidnight();
  }

  private computeResetsAt(
    isMonthly: boolean,
    billingPeriod: BillingPeriodInfo | null,
  ): string {
    if (isMonthly && billingPeriod?.end) {
      return billingPeriod.end.toISOString();
    }

    return isMonthly ? this.endOfMonthISO() : this.midnightISO();
  }

  private async getBillingPeriod(
    organizationId: string,
  ): Promise<BillingPeriodInfo | null> {
    const sub = await this.prisma.subscription.findFirst({
      where: { organizationId, status: 'active' },
      select: { currentPeriodStart: true, currentPeriodEnd: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!sub?.currentPeriodStart || !sub?.currentPeriodEnd) {
      return null;
    }

    return {
      start: sub.currentPeriodStart,
      end: sub.currentPeriodEnd,
    };
  }

  private isMonthlyQuota(quotaType: QuotaType): boolean {
    const monthlyTypes: QuotaType[] = [
      'digestsPerMonth',
      'cameraScansPerMonth',
      'memoDraftingPerMonth',
      'pleadingAssistancePerMonth',
      'caseComparisonPerMonth',
      'timelineGenerationPerMonth',
      'hearingPrepPerMonth',
      'contradictionDetectionPerMonth',
      'documentUploadsPerMonth',
    ];
    return monthlyTypes.includes(quotaType);
  }

  private getLimit(entitlements: SubscriptionEntitlements, quotaType: QuotaType): number {
    return entitlements[quotaType] ?? 0;
  }

  private formatDateKey(date: Date): string {
    return date.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  private secondsUntilMidnight(): number {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCDate(midnight.getUTCDate() + 1);
    midnight.setUTCHours(0, 0, 0, 0);
    return Math.ceil((midnight.getTime() - now.getTime()) / 1000);
  }

  private secondsUntilEndOfMonth(): number {
    const now = new Date();
    const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return Math.ceil((endOfMonth.getTime() - now.getTime()) / 1000);
  }

  private midnightISO(): string {
    const midnight = new Date();
    midnight.setUTCDate(midnight.getUTCDate() + 1);
    midnight.setUTCHours(0, 0, 0, 0);
    return midnight.toISOString();
  }

  private endOfMonthISO(): string {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  }
}

interface BillingPeriodInfo {
  start: Date;
  end: Date;
}
