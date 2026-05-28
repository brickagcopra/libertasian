import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import * as fs from 'fs';

import type { JwtPayload } from '@libertasian/types';

@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: process.env['APP_URL'] || 'http://localhost:3000',
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  afterInit(server: Server) {
    const redisUrl = this.config.get<string>('REDIS_URL', '');
    if (redisUrl) {
      const pubClient = new Redis(redisUrl, {
        keyPrefix: 'nest:ws:',
        lazyConnect: true,
      });
      const subClient = pubClient.duplicate();

      Promise.all([pubClient.connect(), subClient.connect()])
        .then(() => {
          const ioServer = this.server ?? server;
          if (typeof ioServer?.adapter === 'function') {
            ioServer.adapter(createAdapter(pubClient, subClient) as never);
            this.logger.log('Redis adapter attached for horizontal scaling');
          } else {
            this.logger.warn('Socket.IO server.adapter not available — using in-memory adapter');
          }
        })
        .catch((err: unknown) => {
          this.logger.warn(
            `Redis adapter failed, falling back to in-memory: ${String(err)}`,
          );
        });
    } else {
      this.logger.warn(
        'REDIS_URL not configured — using in-memory adapter (single-instance only)',
      );
    }

    this.logger.log('Notifications WebSocket gateway initialized');
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.['token'] as string | undefined) ??
        client.handshake.headers?.['authorization']?.replace('Bearer ', '');

      if (!token) {
        this.logger.debug(`Client ${client.id} rejected: no token`);
        client.emit('error', { message: 'Authentication required' });
        client.disconnect(true);
        return;
      }

      const payload = await this.verifyToken(token);
      if (!payload) {
        this.logger.debug(`Client ${client.id} rejected: invalid token`);
        client.emit('error', { message: 'Invalid or expired token' });
        client.disconnect(true);
        return;
      }

      const userId = payload.sub;
      client.data['userId'] = userId;

      await client.join(`user:${userId}`);
      this.logger.debug(`Client ${client.id} joined room user:${userId}`);
    } catch {
      this.logger.debug(`Client ${client.id} rejected: verification error`);
      client.emit('error', { message: 'Authentication failed' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data['userId'] as string | undefined;
    this.logger.debug(
      `Client ${client.id} disconnected${userId ? ` (user:${userId})` : ''}`,
    );
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  private async verifyToken(token: string): Promise<JwtPayload | null> {
    try {
      const secretOrKey = this.resolveVerificationKey();
      const algorithms = this.resolveAlgorithms();

      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: secretOrKey,
        algorithms,
      });

      if (!payload.sub || !payload.email) {
        return null;
      }

      return payload;
    } catch (err) {
      this.logger.warn(
        `WS JWT verify failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private resolveVerificationKey(): string {
    const publicKeyPath = this.config.get<string>('JWT_PUBLIC_KEY_PATH', '');
    const publicKeyEnv = this.config.get<string>('JWT_PUBLIC_KEY', '');
    const jwtSecret = this.config.get<string>(
      'JWT_SECRET',
      'dev-secret-change-in-production',
    );

    if (publicKeyPath && fs.existsSync(publicKeyPath)) {
      return fs.readFileSync(publicKeyPath, 'utf8');
    }

    if (publicKeyEnv) {
      return Buffer.from(publicKeyEnv, 'base64').toString('utf8');
    }

    return jwtSecret;
  }

  private resolveAlgorithms(): ('RS256' | 'HS256')[] {
    const publicKeyPath = this.config.get<string>('JWT_PUBLIC_KEY_PATH', '');
    const publicKeyEnv = this.config.get<string>('JWT_PUBLIC_KEY', '');

    if (
      (publicKeyPath && fs.existsSync(publicKeyPath)) ||
      publicKeyEnv
    ) {
      return ['RS256'];
    }

    return ['HS256'];
  }
}
