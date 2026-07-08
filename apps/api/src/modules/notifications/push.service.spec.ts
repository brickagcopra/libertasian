import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const mockChunkPushNotifications = jest.fn();
const mockSendPushNotificationsAsync = jest.fn();
const mockIsExpoPushToken = jest.fn();

jest.mock('expo-server-sdk', () => ({
  Expo: Object.assign(
    jest.fn().mockImplementation(() => ({
      chunkPushNotifications: mockChunkPushNotifications,
      sendPushNotificationsAsync: mockSendPushNotificationsAsync,
    })),
    { isExpoPushToken: mockIsExpoPushToken },
  ),
}));

// Imported after the jest.mock so the factory's mock* consts are initialized
// before expo-server-sdk is first required.
import { PushService } from './push.service';

describe('PushService', () => {
  let service: PushService;
  let prisma: {
    pushToken: {
      upsert: jest.Mock;
      deleteMany: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let audit: { log: jest.Mock };

  const userId = 'user-1';
  const token = 'ExponentPushToken[abc123]';

  beforeEach(async () => {
    jest.clearAllMocks();
    mockIsExpoPushToken.mockReturnValue(true);
    // Default: single chunk containing all messages
    mockChunkPushNotifications.mockImplementation(
      (messages: unknown[]) => [messages],
    );

    prisma = {
      pushToken: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PushService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<PushService>(PushService);
  });

  // ---- registerToken ----

  describe('registerToken', () => {
    it('upserts the token and reassigns ownership on re-register', async () => {
      await service.registerToken(userId, token, 'android');

      expect(prisma.pushToken.upsert).toHaveBeenCalledWith({
        where: { token },
        create: { userId, token, platform: 'android' },
        update: {
          userId,
          platform: 'android',
          lastUsedAt: expect.any(Date),
        },
      });
    });

    it('rejects tokens that are not valid Expo push tokens', async () => {
      mockIsExpoPushToken.mockReturnValue(false);

      await expect(
        service.registerToken(userId, 'not-a-token', 'ios'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.pushToken.upsert).not.toHaveBeenCalled();
    });

    it('audit-logs registration with a token hash, never the raw token', async () => {
      await service.registerToken(userId, token, 'ios');

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: userId,
          actorType: 'user',
          action: 'push_token.registered',
          entityType: 'push_token',
        }),
      );
      const entry = audit.log.mock.calls[0][0] as {
        metadata: Record<string, unknown>;
      };
      expect(JSON.stringify(entry)).not.toContain(token);
      expect(typeof entry.metadata['tokenHash']).toBe('string');
      expect((entry.metadata['tokenHash'] as string).length).toBe(12);
    });
  });

  // ---- unregisterToken ----

  describe('unregisterToken', () => {
    it('only deletes rows owned by the caller', async () => {
      prisma.pushToken.deleteMany.mockResolvedValue({ count: 1 });

      const count = await service.unregisterToken(userId, token);

      expect(count).toBe(1);
      expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({
        where: { token, userId },
      });
    });

    it('audit-logs removal only when a row was deleted', async () => {
      prisma.pushToken.deleteMany.mockResolvedValue({ count: 0 });

      await service.unregisterToken(userId, token);

      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  // ---- sendToUser ----

  describe('sendToUser', () => {
    const payload = {
      title: 'Task assigned',
      body: 'Review contract',
      data: {
        notificationId: 'notif-1',
        entityType: 'task',
        entityId: 'task-1',
      },
    };

    it('does nothing when the user has no tokens', async () => {
      prisma.pushToken.findMany.mockResolvedValue([]);

      await service.sendToUser(userId, payload);

      expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
    });

    it('chunks and sends the notification data payload to all device tokens', async () => {
      prisma.pushToken.findMany.mockResolvedValue([
        { token, platform: 'android' },
        { token: 'ExponentPushToken[def456]', platform: 'ios' },
      ]);
      mockSendPushNotificationsAsync.mockResolvedValue([
        { status: 'ok', id: 't1' },
        { status: 'ok', id: 't2' },
      ]);

      await service.sendToUser(userId, payload);

      expect(mockChunkPushNotifications).toHaveBeenCalledWith([
        expect.objectContaining({
          to: token,
          title: payload.title,
          body: payload.body,
          data: payload.data,
        }),
        expect.objectContaining({ to: 'ExponentPushToken[def456]' }),
      ]);
      expect(mockSendPushNotificationsAsync).toHaveBeenCalledTimes(1);
      expect(prisma.pushToken.deleteMany).not.toHaveBeenCalled();
    });

    it('deletes tokens whose tickets report DeviceNotRegistered', async () => {
      const staleToken = 'ExponentPushToken[stale]';
      prisma.pushToken.findMany.mockResolvedValue([
        { token, platform: 'android' },
        { token: staleToken, platform: 'ios' },
      ]);
      mockSendPushNotificationsAsync.mockResolvedValue([
        { status: 'ok', id: 't1' },
        {
          status: 'error',
          message: 'device gone',
          details: { error: 'DeviceNotRegistered' },
        },
      ]);

      await service.sendToUser(userId, payload);

      expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({
        where: { token: { in: [staleToken] } },
      });
    });

    it('does not delete tokens for non-DeviceNotRegistered ticket errors', async () => {
      prisma.pushToken.findMany.mockResolvedValue([
        { token, platform: 'android' },
      ]);
      mockSendPushNotificationsAsync.mockResolvedValue([
        {
          status: 'error',
          message: 'rate limited',
          details: { error: 'MessageRateExceeded' },
        },
      ]);

      await service.sendToUser(userId, payload);

      expect(prisma.pushToken.deleteMany).not.toHaveBeenCalled();
    });

    it('never throws when the Expo send call fails', async () => {
      prisma.pushToken.findMany.mockResolvedValue([
        { token, platform: 'android' },
      ]);
      mockSendPushNotificationsAsync.mockRejectedValue(
        new Error('expo unavailable'),
      );

      await expect(service.sendToUser(userId, payload)).resolves.toBeUndefined();
    });

    it('never throws when the token lookup fails', async () => {
      prisma.pushToken.findMany.mockRejectedValue(new Error('db down'));

      await expect(service.sendToUser(userId, payload)).resolves.toBeUndefined();
    });

    it('never throws when the stale-token cleanup fails', async () => {
      prisma.pushToken.findMany.mockResolvedValue([
        { token, platform: 'android' },
      ]);
      mockSendPushNotificationsAsync.mockResolvedValue([
        {
          status: 'error',
          message: 'device gone',
          details: { error: 'DeviceNotRegistered' },
        },
      ]);
      prisma.pushToken.deleteMany.mockRejectedValue(new Error('db down'));

      await expect(service.sendToUser(userId, payload)).resolves.toBeUndefined();
    });
  });
});
