import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PlatformGrantsService } from '../../rbac/platform-grants.service';
import {
  assessSharing,
  DEFAULT_SHARING_THRESHOLDS,
  type SharingEvent,
  type SharingThresholds,
  type TravelJump,
} from './detect-sharing';

/** Events that mean "this account was being used from here". */
const USAGE_EVENT_TYPES = ['login_success', 'google_login', 'apple_login', 'token_refresh'];
/** Bound on rows scanned per report: the window is short and this is a review tool. */
const MAX_EVENTS = 100_000;

export interface SharingSignal {
  userId: string;
  email: string;
  fullName: string;
  reasons: ('many_places' | 'impossible_travel')[];
  places: string[];
  jumps: TravelJump[];
  events: number;
  lastSeenAt: Date;
}

export interface SharingReport {
  windowHours: number;
  thresholds: SharingThresholds;
  scannedEvents: number;
  truncated: boolean;
  signals: SharingSignal[];
}

/**
 * Possible account sharing (device limits, phase 2c): accounts seen in many
 * distinct places, or travelling impossibly fast, inside a window. Built on
 * login_events, which already records the geoip-lite location of every
 * sign-in and token refresh. Advisory only: it reports and alerts staff and
 * never changes an account. See detect-sharing.ts for the signals and why
 * IP counts are deliberately not one of them.
 */
@Injectable()
export class AccountSharingService {
  private readonly logger = new Logger(AccountSharingService.name);
  private readonly thresholds: SharingThresholds;
  private readonly alertEnabled: boolean;
  private readonly alertWindowHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly platformGrants: PlatformGrantsService,
  ) {
    const num = (key: string, fallback: number) => {
      const v = Number(this.config.get<number | string>(key, fallback));
      return Number.isFinite(v) && v > 0 ? v : fallback;
    };
    this.thresholds = {
      minPlaces: num('SHARING_MIN_PLACES', DEFAULT_SHARING_THRESHOLDS.minPlaces),
      minJumpKm: num('SHARING_MIN_JUMP_KM', DEFAULT_SHARING_THRESHOLDS.minJumpKm),
      maxSpeedKmh: num('SHARING_MAX_SPEED_KMH', DEFAULT_SHARING_THRESHOLDS.maxSpeedKmh),
    };
    const rawEnabled = this.config.get<boolean | string>('SHARING_ALERT_ENABLED', true);
    this.alertEnabled = rawEnabled === true || rawEnabled === 'true';
    this.alertWindowHours = num('SHARING_WINDOW_HOURS', 24);
  }

  async report(windowHours: number = this.alertWindowHours): Promise<SharingReport> {
    const since = new Date(Date.now() - windowHours * 3600_000);
    const rows = await this.prisma.loginEvent.findMany({
      where: { createdAt: { gte: since }, eventType: { in: USAGE_EVENT_TYPES } },
      select: {
        userId: true,
        createdAt: true,
        country: true,
        region: true,
        city: true,
        latitude: true,
        longitude: true,
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_EVENTS,
    });

    const byUser = new Map<string, SharingEvent[]>();
    for (const { userId, ...event } of rows) {
      const list = byUser.get(userId);
      if (list) list.push(event);
      else byUser.set(userId, [event]);
    }

    const flagged: Omit<SharingSignal, 'email' | 'fullName'>[] = [];
    for (const [userId, events] of byUser) {
      const result = assessSharing(events, this.thresholds);
      if (!result.flagged) continue;
      flagged.push({
        userId,
        reasons: result.reasons,
        places: result.places,
        jumps: result.jumps,
        events: events.length,
        lastSeenAt: events.reduce((max, e) => (e.createdAt > max ? e.createdAt : max), events[0]!.createdAt),
      });
    }

    const users = flagged.length
      ? await this.prisma.user.findMany({
          where: { id: { in: flagged.map((f) => f.userId) } },
          select: { id: true, email: true, fullName: true },
        })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    const signals = flagged
      .map((f) => ({
        ...f,
        email: userById.get(f.userId)?.email ?? '',
        fullName: userById.get(f.userId)?.fullName ?? '',
      }))
      // Impossible travel first, then most places.
      .sort(
        (a, b) =>
          b.jumps.length - a.jumps.length ||
          b.places.length - a.places.length ||
          b.lastSeenAt.getTime() - a.lastSeenAt.getTime(),
      );

    return {
      windowHours,
      thresholds: this.thresholds,
      scannedEvents: rows.length,
      truncated: rows.length === MAX_EVENTS,
      signals,
    };
  }

  /**
   * 08:00 Asia/Manila: email staff holding admin:users when the last day
   * flagged anyone, and leave an audit entry per flagged account. Silent when
   * nothing is flagged. Never touches the accounts themselves.
   */
  @Cron('0 0 * * *', { name: 'account-sharing-daily', timeZone: 'UTC' })
  async sendDailyAlert(): Promise<void> {
    if (!this.alertEnabled) return;
    try {
      const report = await this.report(this.alertWindowHours);
      if (report.signals.length === 0) return;

      for (const s of report.signals) {
        await this.audit.log({
          actorType: 'system',
          action: 'security.account_sharing_suspected',
          entityType: 'user',
          entityId: s.userId,
          metadata: {
            reasons: s.reasons,
            places: s.places,
            jumps: s.jumps.map((j) => ({ from: j.from, to: j.to, km: j.km, minutes: j.minutes })),
            windowHours: report.windowHours,
          },
        });
      }

      const n = report.signals.length;
      const lines = report.signals.slice(0, 10).map((s) => {
        const why = s.jumps[0]
          ? `${s.jumps[0].from} to ${s.jumps[0].to} in ${s.jumps[0].minutes} min`
          : `${s.places.length} places`;
        // User id, not email: this leaves the platform by email.
        return `User ${s.userId.slice(0, 8)}: ${why}`;
      });
      if (n > 10) lines.push(`…and ${n - 10} more`);

      const staff = await this.platformGrants.listUsersWithPlatformPermission('admin:users');
      await Promise.all(
        staff.map((m) =>
          this.notifications
            .sendSecurityAlert({
              email: m.email,
              fullName: m.fullName,
              heading: `${n} account${n === 1 ? '' : 's'} may be shared`,
              lines,
            })
            .catch((err: unknown) =>
              this.logger.warn(
                `Security alert failed: ${err instanceof Error ? err.message : String(err)}`,
              ),
            ),
        ),
      );
      this.logger.warn(`account_sharing_suspected count=${n} window_h=${report.windowHours}`);
    } catch (err) {
      this.logger.warn(
        `Account-sharing daily alert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
