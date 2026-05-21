import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const geoip = require('geoip-lite') as {
  lookup: (ip: string) => {
    country?: string;
    region?: string;
    city?: string;
    ll?: [number, number];
  } | null;
};

import { PrismaService } from '../../prisma/prisma.service';

export type LoginEventType =
  | 'login_success'
  | 'login_failed'
  | 'google_login'
  | 'token_refresh'
  | 'logout'
  | 'password_reset_used'
  | 'password_changed'
  | 'mfa_challenge_passed'
  | 'mfa_challenge_failed';

export interface LoginEventExtra {
  failureReason?: string;
  deviceFingerprint?: string;
}

interface GeoFields {
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}

const NULL_GEO: GeoFields = {
  country: null,
  region: null,
  city: null,
  latitude: null,
  longitude: null,
};

/**
 * Captures authentication events with IP + user-agent + geo so admins can
 * surface login activity on the user detail page (Phase 2 of admin users).
 *
 * Geo lookup is in-process via geoip-lite (bundled MaxMind GeoLite). No
 * outbound HTTP at runtime; lookup is ~1ms and never throws — failures
 * persist the event with null geo fields.
 *
 * Callers MUST invoke this fire-and-forget (`void this.loginEvents.record(...)`)
 * so login latency is unchanged when DB is slow or geo lookup degrades.
 */
@Injectable()
export class LoginEventService {
  private readonly logger = new Logger(LoginEventService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist one login event row + (on login_success / google_login) refresh
   * User.lastLogin* columns. Resolves on success; rejects on DB error so the
   * caller's `.catch()` runs.
   */
  async record(
    eventType: LoginEventType,
    userId: string,
    req: Request | null,
    extra: LoginEventExtra = {},
  ): Promise<void> {
    const ipAddress = this.extractIp(req);
    const userAgent = this.extractUserAgent(req);
    const geo = this.lookupGeo(ipAddress);

    try {
      await this.prisma.loginEvent.create({
        data: {
          userId,
          eventType,
          ipAddress,
          userAgent,
          country: geo.country,
          region: geo.region,
          city: geo.city,
          latitude: geo.latitude,
          longitude: geo.longitude,
          deviceFingerprint: extra.deviceFingerprint ?? null,
          failureReason: extra.failureReason ?? null,
        },
      });

      // Update lastLogin* snapshot on successful authentications so the admin
      // list view can render without joining login_events.
      if (eventType === 'login_success' || eventType === 'google_login') {
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            lastLoginAt: new Date(),
            lastLoginIp: ipAddress,
            lastLoginCountry: geo.country,
            lastLoginCity: geo.city,
            lastLoginRegion: geo.region,
          },
        });
      }

      this.logger.debug(
        `login_event ${eventType} user=${userId} ip=${ipAddress ?? 'unknown'} country=${geo.country ?? '-'}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to record login event ${eventType} for user ${userId}: ${message}`);
      throw err;
    }
  }

  private extractIp(req: Request | null): string | null {
    if (!req) return null;
    const ip = req.ip;
    if (!ip) return null;
    // Express normalizes IPv4-mapped IPv6 (::ffff:1.2.3.4) — strip the prefix
    // so geoip-lite sees a plain IPv4 string.
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  }

  private extractUserAgent(req: Request | null): string | null {
    if (!req) return null;
    const ua = req.headers['user-agent'];
    if (!ua) return null;
    return Array.isArray(ua) ? (ua[0] ?? null) : ua;
  }

  private lookupGeo(ip: string | null): GeoFields {
    if (!ip) return NULL_GEO;
    try {
      const hit = geoip.lookup(ip);
      if (!hit) return NULL_GEO;
      return {
        country: hit.country ?? null,
        region: hit.region ?? null,
        city: hit.city ?? null,
        latitude: hit.ll?.[0] ?? null,
        longitude: hit.ll?.[1] ?? null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Geo lookup failed for ip=${ip}: ${message}`);
      return NULL_GEO;
    }
  }
}
