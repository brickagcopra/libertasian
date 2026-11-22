import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { LoginEventService } from './login-event.service';

export interface NewSessionContext {
  userId: string;
  /** The organization the user is signing into (from the resolved membership). */
  organizationId: string;
  /** familyId of the refresh-token family that was just created. */
  familyId: string;
  /** Validated X-Device-Id, or null when the client sent none / an invalid one. */
  deviceId: string | null;
}

interface ActiveFamily {
  familyId: string;
  lastUsedAt: Date;
  deviceName: string | null;
  deviceFingerprint: string | null;
}

/**
 * Per-account device limits, phase 1.
 *
 * Runs once whenever a NEW refresh-token family is created (password, Google
 * and Apple sign-in) — never on refresh rotation, which only extends an
 * existing family. Two steps:
 *
 *  a. Same-device dedupe: a sign-in that carries a device id revokes this
 *     user's other live families with that same device id. Always on — it
 *     only cleans up duplicates of one device.
 *  b. Plan cap (behind DEVICE_LIMITS_ENABLED): if the user's live families
 *     exceed the cap for the organization's plan (pro 3, edu 2, others
 *     uncapped), the least recently used OTHER families are revoked until
 *     they fit. The new sign-in is never blocked.
 *
 * Every step fails OPEN: any error logs a structured warning and the sign-in
 * proceeds untouched.
 */
@Injectable()
export class DeviceLimitService {
  private readonly logger = new Logger(DeviceLimitService.name);
  private readonly enabled: boolean;
  private readonly limits: Readonly<Record<string, number>>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly subscriptions: SubscriptionsService,
    private readonly loginEvents: LoginEventService,
    private readonly audit: AuditService,
  ) {
    const rawEnabled = this.config.get<boolean | string>('DEVICE_LIMITS_ENABLED', false);
    this.enabled = rawEnabled === true || rawEnabled === 'true';
    this.limits = {
      pro: Number(this.config.get<number | string>('DEVICE_LIMIT_PRO', 3)),
      edu: Number(this.config.get<number | string>('DEVICE_LIMIT_EDU', 2)),
    };
  }

  /** Device cap for a plan code, or null when the plan is uncapped. */
  limitForTier(tier: string): number | null {
    const limit = this.limits[tier];
    return limit !== undefined && Number.isFinite(limit) && limit >= 1 ? limit : null;
  }

  /** Apply same-device dedupe and the plan cap after a new family is issued. Never throws. */
  async enforceOnNewSession(ctx: NewSessionContext): Promise<void> {
    await this.revokeSameDevice(ctx);
    if (this.enabled) {
      await this.enforceCap(ctx);
    }
  }

  private async revokeSameDevice(ctx: NewSessionContext): Promise<void> {
    if (!ctx.deviceId) return;
    try {
      const result = await this.prisma.refreshToken.updateMany({
        where: {
          userId: ctx.userId,
          deviceId: ctx.deviceId,
          familyId: { not: ctx.familyId },
          isRevoked: false,
        },
        data: { isRevoked: true },
      });
      if (result.count > 0) {
        this.logger.log(
          `device_dedupe user=${ctx.userId} revoked_tokens=${result.count}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `device_dedupe failed open user=${ctx.userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async enforceCap(ctx: NewSessionContext): Promise<void> {
    try {
      const tier = await this.subscriptions.getPlanCode(ctx.organizationId);
      const limit = this.limitForTier(tier);
      if (limit === null) return;

      const families = await this.activeFamilies(ctx.userId);
      if (families.length <= limit) return;

      const evict = families
        .filter((f) => f.familyId !== ctx.familyId)
        .sort((a, b) => a.lastUsedAt.getTime() - b.lastUsedAt.getTime())
        .slice(0, families.length - limit);

      for (const family of evict) {
        await this.evict(ctx, family, tier, limit);
      }
    } catch (err) {
      this.logger.warn(
        `device_limit failed open user=${ctx.userId} org=${ctx.organizationId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * The user's live families (any non-revoked, unexpired token), each with
   * its newest token's createdAt as last use — rotation creates a new row per
   * refresh, so the newest row tracks the last refresh.
   */
  private async activeFamilies(userId: string): Promise<ActiveFamily[]> {
    const rows = await this.prisma.refreshToken.findMany({
      where: { userId, isRevoked: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: {
        familyId: true,
        createdAt: true,
        deviceName: true,
        deviceFingerprint: true,
      },
    });
    const byFamily = new Map<string, ActiveFamily>();
    for (const row of rows) {
      if (!byFamily.has(row.familyId)) {
        byFamily.set(row.familyId, {
          familyId: row.familyId,
          lastUsedAt: row.createdAt,
          deviceName: row.deviceName,
          deviceFingerprint: row.deviceFingerprint,
        });
      }
    }
    return [...byFamily.values()];
  }

  private async evict(
    ctx: NewSessionContext,
    family: ActiveFamily,
    tier: string,
    limit: number,
  ): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId: ctx.userId, familyId: family.familyId },
      data: { isRevoked: true },
    });

    // No request context: the evicted device is not the caller, so the
    // event must not record the new sign-in's IP / user agent against it.
    void this.loginEvents
      .record('session_evicted', ctx.userId, null, {
        failureReason: 'device_limit',
        deviceFingerprint: family.deviceFingerprint ?? undefined,
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `login_event session_evicted dropped for user ${ctx.userId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    // AuditService.log swallows its own errors.
    await this.audit.log({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      actorType: 'system',
      action: 'auth.session_evicted',
      entityType: 'session',
      entityId: family.familyId,
      metadata: {
        familyId: family.familyId,
        deviceName: family.deviceName,
        reason: 'device_limit',
        limit,
        tier,
      },
    });

    this.logger.log(
      `session_evicted user=${ctx.userId} family=${family.familyId} tier=${tier} limit=${limit}`,
    );
  }
}
