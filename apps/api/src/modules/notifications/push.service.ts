import { createHash } from 'crypto';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Expo } from 'expo-server-sdk';
import type { ExpoPushMessage } from 'expo-server-sdk';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface PushPayload {
  title: string;
  body?: string;
  data: {
    notificationId: string;
    entityType?: string;
    entityId?: string;
  };
}

/**
 * Push tokens are credentials — never log or audit the raw value. A short
 * sha256 prefix is enough to correlate register/unregister/cleanup events.
 */
function tokenHashPrefix(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly expo = new Expo();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Upsert a device token for the authenticated user. A token is globally
   * unique per device; if it re-registers (e.g. a different account signs in
   * on the same device), ownership moves to the new user so pushes never go
   * to a signed-out account.
   */
  async registerToken(
    userId: string,
    token: string,
    platform: 'ios' | 'android',
  ): Promise<void> {
    if (!Expo.isExpoPushToken(token)) {
      throw new BadRequestException('Invalid Expo push token');
    }

    await this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform, lastUsedAt: new Date() },
    });

    await this.audit.log({
      actorUserId: userId,
      actorType: 'user',
      action: 'push_token.registered',
      entityType: 'push_token',
      metadata: { tokenHash: tokenHashPrefix(token), platform },
    });
  }

  /**
   * Delete a device token. Scoped to the caller — a user can only remove
   * tokens they own, so this endpoint cannot be used to unregister someone
   * else's device.
   */
  async unregisterToken(userId: string, token: string): Promise<number> {
    const result = await this.prisma.pushToken.deleteMany({
      where: { token, userId },
    });

    if (result.count > 0) {
      await this.audit.log({
        actorUserId: userId,
        actorType: 'user',
        action: 'push_token.unregistered',
        entityType: 'push_token',
        metadata: { tokenHash: tokenHashPrefix(token) },
      });
    }

    return result.count;
  }

  /**
   * Best-effort device push to all of a user's registered devices. This is
   * fired-and-forgotten from notification creation and MUST NEVER throw —
   * every failure path logs a structured warning and resolves.
   *
   * Tokens whose tickets come back `DeviceNotRegistered` are deleted so we
   * stop pushing to uninstalled/expired devices.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    try {
      const tokens = await this.prisma.pushToken.findMany({
        where: { userId },
      });
      if (tokens.length === 0) {
        return;
      }

      const messages: ExpoPushMessage[] = tokens.map((t) => ({
        to: t.token,
        sound: 'default' as const,
        title: payload.title,
        body: payload.body,
        data: payload.data,
      }));

      const chunks = this.expo.chunkPushNotifications(messages);
      const staleTokens: string[] = [];
      let anySent = false;

      for (const chunk of chunks) {
        try {
          const tickets = await this.expo.sendPushNotificationsAsync(chunk);
          anySent = true;
          tickets.forEach((ticket, index) => {
            if (ticket.status !== 'error') {
              return;
            }
            const to = chunk[index]?.to;
            const tokenRef =
              typeof to === 'string' ? tokenHashPrefix(to) : 'unknown';
            this.logger.warn(
              `Push ticket error user=${userId} token=${tokenRef} error=${ticket.details?.error ?? 'unknown'}`,
            );
            if (
              ticket.details?.error === 'DeviceNotRegistered' &&
              typeof to === 'string'
            ) {
              staleTokens.push(to);
            }
          });
        } catch (err) {
          this.logger.warn(
            `Push chunk send failed user=${userId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (staleTokens.length > 0) {
        await this.prisma.pushToken.deleteMany({
          where: { token: { in: staleTokens } },
        });
        this.logger.warn(
          `Removed ${staleTokens.length} DeviceNotRegistered push token(s) user=${userId}`,
        );
      }

      if (anySent) {
        const liveTokens = tokens
          .map((t) => t.token)
          .filter((t) => !staleTokens.includes(t));
        if (liveTokens.length > 0) {
          await this.prisma.pushToken.updateMany({
            where: { token: { in: liveTokens } },
            data: { lastUsedAt: new Date() },
          });
        }
      }
    } catch (err) {
      // Best-effort: device push must never block or fail notification creation.
      this.logger.warn(
        `Push send failed user=${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
