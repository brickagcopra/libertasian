import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { parseDeviceId, parseDeviceName, readDeviceIdentity } from './device-identity';
import { DeviceLimitService, type NewSessionContext } from './device-limit.service';
import type { LoginEventService } from './login-event.service';

interface TokenRow {
  familyId: string;
  createdAt: Date;
  deviceName: string | null;
  deviceFingerprint: string | null;
}

const NEW_FAMILY = 'fam-new';
const DEVICE_ID = '3f2a9c1e-4b7d-4e8a-9c0f-1a2b3c4d5e6f';

function minutesAgo(n: number): Date {
  return new Date(Date.now() - n * 60_000);
}

/** Rows newest-first, as the service's findMany orders them. */
function rows(...families: Array<[string, number]>): TokenRow[] {
  return families
    .map(([familyId, ago]) => ({
      familyId,
      createdAt: minutesAgo(ago),
      deviceName: `${familyId} device`,
      deviceFingerprint: `${familyId}-fp`,
    }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function build(opts: {
  enabled?: boolean | string;
  tier?: string;
  planError?: Error;
  tokens?: TokenRow[];
  config?: Record<string, unknown>;
}) {
  const prisma = {
    refreshToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue(opts.tokens ?? []),
    },
  };
  const values: Record<string, unknown> = {
    DEVICE_LIMITS_ENABLED: opts.enabled ?? true,
    ...(opts.config ?? {}),
  };
  const config = {
    get: jest.fn((key: string, def?: unknown) => (key in values ? values[key] : def)),
  };
  const subscriptions = {
    getPlanCode: opts.planError
      ? jest.fn().mockRejectedValue(opts.planError)
      : jest.fn().mockResolvedValue(opts.tier ?? 'free'),
  };
  const loginEvents = { record: jest.fn().mockResolvedValue(undefined) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };

  const service = new DeviceLimitService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    subscriptions as unknown as SubscriptionsService,
    loginEvents as unknown as LoginEventService,
    audit as unknown as AuditService,
  );
  return { service, prisma, subscriptions, loginEvents, audit };
}

const ctx = (deviceId: string | null = null): NewSessionContext => ({
  userId: 'user-1',
  organizationId: 'org-1',
  familyId: NEW_FAMILY,
  deviceId,
});

/** familyIds revoked by the cap step (updateMany calls keyed on familyId). */
function evictedFamilies(prisma: ReturnType<typeof build>['prisma']): string[] {
  return prisma.refreshToken.updateMany.mock.calls
    .map(([arg]) => (arg as { where: { familyId?: unknown } }).where.familyId)
    .filter((f): f is string => typeof f === 'string');
}

describe('DeviceLimitService', () => {
  describe('same-device re-login', () => {
    it("revokes the user's other live families carrying the same device id", async () => {
      const { service, prisma } = build({ enabled: false });
      prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 2 });

      await service.enforceOnNewSession(ctx(DEVICE_ID));

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          deviceId: DEVICE_ID,
          familyId: { not: NEW_FAMILY },
          isRevoked: false,
        },
        data: { isRevoked: true },
      });
    });

    it('does nothing without a device id', async () => {
      const { service, prisma } = build({ enabled: false });
      await service.enforceOnNewSession(ctx(null));
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('fails open when the dedupe update throws', async () => {
      const { service, prisma } = build({ tier: 'pro', tokens: rows([NEW_FAMILY, 0]) });
      prisma.refreshToken.updateMany.mockRejectedValueOnce(new Error('db down'));
      await expect(service.enforceOnNewSession(ctx(DEVICE_ID))).resolves.toBeUndefined();
    });
  });

  describe('plan cap', () => {
    it('Pro: evicts down to 3, least recently used first', async () => {
      const { service, prisma, loginEvents, audit } = build({
        tier: 'pro',
        tokens: rows([NEW_FAMILY, 0], ['fam-a', 5], ['fam-b', 300], ['fam-c', 60], ['fam-d', 1000]),
      });

      await service.enforceOnNewSession(ctx());

      expect(evictedFamilies(prisma)).toEqual(['fam-d', 'fam-b']);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', familyId: 'fam-d' },
        data: { isRevoked: true },
      });
      expect(loginEvents.record).toHaveBeenCalledWith('session_evicted', 'user-1', null, {
        failureReason: 'device_limit',
        deviceFingerprint: 'fam-d-fp',
      });
      expect(audit.log).toHaveBeenCalledWith({
        organizationId: 'org-1',
        actorUserId: 'user-1',
        actorType: 'system',
        action: 'auth.session_evicted',
        entityType: 'session',
        entityId: 'fam-d',
        metadata: {
          familyId: 'fam-d',
          deviceName: 'fam-d device',
          reason: 'device_limit',
          limit: 3,
          tier: 'pro',
        },
      });
      expect(audit.log).toHaveBeenCalledTimes(2);
    });

    it('Pro: three devices including the new one fit, nothing evicted', async () => {
      const { service, prisma } = build({
        tier: 'pro',
        tokens: rows([NEW_FAMILY, 0], ['fam-a', 5], ['fam-b', 300]),
      });
      await service.enforceOnNewSession(ctx());
      expect(evictedFamilies(prisma)).toEqual([]);
    });

    it('Edu: cap 2 evicts the least recently used other device', async () => {
      const { service, prisma } = build({
        tier: 'edu',
        tokens: rows([NEW_FAMILY, 0], ['fam-a', 5], ['fam-b', 300]),
      });
      await service.enforceOnNewSession(ctx());
      expect(evictedFamilies(prisma)).toEqual(['fam-b']);
    });

    it('never evicts the new family even when it is somehow the oldest row', async () => {
      const { service, prisma } = build({
        tier: 'edu',
        tokens: rows([NEW_FAMILY, 9999], ['fam-a', 5], ['fam-b', 10]),
      });
      await service.enforceOnNewSession(ctx());
      expect(evictedFamilies(prisma)).toEqual(['fam-b']);
    });

    it('uses each family\'s newest token as its last use', async () => {
      const { service, prisma } = build({
        tier: 'edu',
        // fam-a was created long ago but refreshed 1 minute ago; fam-b once, 10 min ago.
        tokens: rows([NEW_FAMILY, 0], ['fam-a', 1], ['fam-b', 10], ['fam-a', 5000]),
      });
      await service.enforceOnNewSession(ctx());
      expect(evictedFamilies(prisma)).toEqual(['fam-b']);
    });

    it.each(['free', 'team', 'enterprise', 'something-new'])('%s: no cap', async (tier) => {
      const { service, prisma } = build({
        tier,
        tokens: rows([NEW_FAMILY, 0], ['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5]),
      });
      await service.enforceOnNewSession(ctx());
      expect(evictedFamilies(prisma)).toEqual([]);
    });

    it('honours configured caps', async () => {
      const { service, prisma } = build({
        tier: 'pro',
        config: { DEVICE_LIMIT_PRO: 1 },
        tokens: rows([NEW_FAMILY, 0], ['fam-a', 5]),
      });
      await service.enforceOnNewSession(ctx());
      expect(evictedFamilies(prisma)).toEqual(['fam-a']);
    });

    it('resolves the tier for the organization being signed into', async () => {
      const { service, subscriptions } = build({ tier: 'pro', tokens: [] });
      await service.enforceOnNewSession(ctx());
      expect(subscriptions.getPlanCode).toHaveBeenCalledWith('org-1');
    });
  });

  describe('flag off', () => {
    it.each([false, 'false', undefined])('DEVICE_LIMITS_ENABLED=%p: no plan lookup, no eviction', async (enabled) => {
      const { service, prisma, subscriptions } = build({
        enabled: enabled as boolean | string,
        tier: 'edu',
        tokens: rows([NEW_FAMILY, 0], ['a', 1], ['b', 2], ['c', 3]),
        config: enabled === undefined ? { DEVICE_LIMITS_ENABLED: undefined } : {},
      });
      await service.enforceOnNewSession(ctx());
      expect(subscriptions.getPlanCode).not.toHaveBeenCalled();
      expect(prisma.refreshToken.findMany).not.toHaveBeenCalled();
      expect(evictedFamilies(prisma)).toEqual([]);
    });

    it("accepts the string 'true' as enabled", async () => {
      const { service, prisma } = build({
        enabled: 'true',
        tier: 'edu',
        tokens: rows([NEW_FAMILY, 0], ['a', 1], ['b', 2]),
      });
      await service.enforceOnNewSession(ctx());
      expect(evictedFamilies(prisma)).toEqual(['b']);
    });
  });

  describe('fail open', () => {
    it('resolves without evicting when the plan lookup throws', async () => {
      const { service, prisma } = build({
        planError: new Error('db down'),
        tokens: rows([NEW_FAMILY, 0], ['a', 1], ['b', 2], ['c', 3], ['d', 4]),
      });
      await expect(service.enforceOnNewSession(ctx(DEVICE_ID))).resolves.toBeUndefined();
      expect(prisma.refreshToken.findMany).not.toHaveBeenCalled();
      expect(evictedFamilies(prisma)).toEqual([]);
    });

    it('resolves when the session query throws', async () => {
      const { service, prisma } = build({ tier: 'pro' });
      prisma.refreshToken.findMany.mockRejectedValueOnce(new Error('timeout'));
      await expect(service.enforceOnNewSession(ctx())).resolves.toBeUndefined();
    });

    it('a dropped login event does not break eviction', async () => {
      const { service, prisma, loginEvents } = build({
        tier: 'edu',
        tokens: rows([NEW_FAMILY, 0], ['a', 1], ['b', 2]),
      });
      loginEvents.record.mockRejectedValueOnce(new Error('insert failed'));
      await expect(service.enforceOnNewSession(ctx())).resolves.toBeUndefined();
      expect(evictedFamilies(prisma)).toEqual(['b']);
    });
  });
});

describe('device identity headers', () => {
  it('accepts a UUID-shaped id, trimmed and lowercased', () => {
    expect(parseDeviceId(`  ${DEVICE_ID.toUpperCase()} `)).toBe(DEVICE_ID);
  });

  it.each([undefined, '', 'abc', `${DEVICE_ID}x`, 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz', 'x'.repeat(64)])(
    'treats device id %p as absent',
    (raw) => {
      expect(parseDeviceId(raw)).toBeNull();
    },
  );

  it('takes the first value of a repeated header', () => {
    expect(parseDeviceId([DEVICE_ID, 'junk'])).toBe(DEVICE_ID);
  });

  it('accepts a trimmed printable name up to 120 characters', () => {
    expect(parseDeviceName('  Chrome on Windows ')).toBe('Chrome on Windows');
    expect(parseDeviceName('iPhone (iOS 26)')).toBe('iPhone (iOS 26)');
    expect(parseDeviceName('a'.repeat(120))).toBe('a'.repeat(120));
  });

  it.each([undefined, '', '   ', 'a'.repeat(121), 'bad\u0000name', 'line\nbreak', 'tab\there'])(
    'treats device name %p as absent',
    (raw) => {
      expect(parseDeviceName(raw)).toBeNull();
    },
  );

  it('reads both headers from a request and tolerates a missing request', () => {
    expect(readDeviceIdentity(null)).toEqual({ deviceId: null, deviceName: null });
    expect(
      readDeviceIdentity({
        headers: { 'x-device-id': DEVICE_ID, 'x-device-name': 'Pixel 8 (Android 15)' },
      } as unknown as import('express').Request),
    ).toEqual({ deviceId: DEVICE_ID, deviceName: 'Pixel 8 (Android 15)' });
  });
});
