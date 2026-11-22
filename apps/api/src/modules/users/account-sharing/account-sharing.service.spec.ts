import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { PlatformGrantsService } from '../../rbac/platform-grants.service';
import { AccountSharingService } from './account-sharing.service';

const MANILA = { country: 'PH', region: 'NCR', city: 'Manila', latitude: 14.5995, longitude: 120.9842 };
const SINGAPORE = { country: 'SG', region: '01', city: 'Singapore', latitude: 1.3521, longitude: 103.8198 };

describe('AccountSharingService', () => {
  let prisma: { loginEvent: { findMany: jest.Mock }; user: { findMany: jest.Mock } };
  let audit: { log: jest.Mock };
  let notifications: { sendSecurityAlert: jest.Mock };
  let grants: { listUsersWithPlatformPermission: jest.Mock };

  const build = (env: Record<string, unknown> = {}) =>
    new AccountSharingService(
      prisma as unknown as PrismaService,
      { get: (k: string, d?: unknown) => (k in env ? env[k] : d) } as unknown as ConfigService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
      grants as unknown as PlatformGrantsService,
    );

  const now = Date.now();
  const ev = (userId: string, minutesAgo: number, place: object) => ({
    userId,
    createdAt: new Date(now - minutesAgo * 60000),
    ...place,
  });

  beforeEach(() => {
    prisma = {
      loginEvent: {
        findMany: jest.fn().mockResolvedValue([
          // u1: Manila then Singapore 20 minutes later -> impossible travel
          ev('u1', 30, MANILA),
          ev('u1', 10, SINGAPORE),
          // u2: stays in Manila -> not flagged
          ev('u2', 50, MANILA),
          ev('u2', 5, MANILA),
        ]),
      },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'u1', email: 'a@example.com', fullName: 'Ana' }]),
      },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    notifications = { sendSecurityAlert: jest.fn().mockResolvedValue(undefined) };
    grants = {
      listUsersWithPlatformPermission: jest
        .fn()
        .mockResolvedValue([{ userId: 's1', email: 'staff@example.com', fullName: 'Staff' }]),
    };
  });

  it('reports only flagged accounts, with names and the travel jump', async () => {
    const report = await build().report(24);
    expect(prisma.loginEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          eventType: { in: ['login_success', 'google_login', 'apple_login', 'token_refresh'] },
        }),
      }),
    );
    expect(report.scannedEvents).toBe(4);
    expect(report.signals).toHaveLength(1);
    expect(report.signals[0]).toMatchObject({
      userId: 'u1',
      email: 'a@example.com',
      reasons: ['impossible_travel'],
      events: 2,
    });
    expect(report.signals[0]!.jumps[0]).toMatchObject({ from: 'Manila, PH', to: 'Singapore, SG' });
  });

  it('skips the user lookup when nothing is flagged', async () => {
    prisma.loginEvent.findMany.mockResolvedValue([ev('u2', 5, MANILA)]);
    const report = await build().report(24);
    expect(report.signals).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('reads thresholds from env', async () => {
    const report = await build({ SHARING_MIN_PLACES: '2' }).report(24);
    expect(report.thresholds.minPlaces).toBe(2);
  });

  it('daily alert audits each flagged account and emails staff without user emails', async () => {
    await build().sendDailyAlert();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'security.account_sharing_suspected',
        entityId: 'u1',
        actorType: 'system',
      }),
    );
    expect(grants.listUsersWithPlatformPermission).toHaveBeenCalledWith('admin:users');
    const alert = notifications.sendSecurityAlert.mock.calls[0]![0];
    expect(alert).toMatchObject({
      email: 'staff@example.com',
      heading: '1 account may be shared',
    });
    expect(alert.lines.join(' ')).not.toContain('a@example.com');
  });

  it('daily alert is silent when nothing is flagged or when disabled', async () => {
    prisma.loginEvent.findMany.mockResolvedValue([]);
    await build().sendDailyAlert();
    await build({ SHARING_ALERT_ENABLED: 'false' }).sendDailyAlert();
    expect(notifications.sendSecurityAlert).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('daily alert never throws', async () => {
    prisma.loginEvent.findMany.mockRejectedValue(new Error('db down'));
    await expect(build().sendDailyAlert()).resolves.toBeUndefined();
  });
});
