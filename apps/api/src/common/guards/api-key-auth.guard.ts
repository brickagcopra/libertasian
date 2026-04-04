import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import type { Request } from 'express';

import { PrismaService } from '../../prisma/prisma.service';

export const API_KEY_PERMISSIONS_KEY = 'api_key_permissions';

/**
 * Guard that authenticates requests via X-API-Key header.
 * Used for Enterprise external API endpoints.
 *
 * Validates:
 * - Key exists and is active
 * - Key is not expired
 * - Key has the required permissions
 * - Updates lastUsedAt timestamp
 *
 * Attaches apiKey context and a synthetic user object to the request
 * for downstream guards (TenantGuard, SubscriptionGuard).
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyAuthGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKeyHeader = request.headers['x-api-key'] as string | undefined;

    if (!apiKeyHeader) {
      throw new UnauthorizedException(
        'Missing X-API-Key header. Provide a valid API key.',
      );
    }

    // Hash the key to look it up
    const keyHash = createHash('sha256').update(apiKeyHeader).digest('hex');

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      include: {
        organization: { select: { id: true, slug: true } },
        user: { select: { id: true, email: true, fullName: true } },
      },
    });

    if (!apiKey) {
      throw new UnauthorizedException('Invalid API key.');
    }

    if (!apiKey.isActive) {
      throw new UnauthorizedException('API key is deactivated.');
    }

    if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
      throw new UnauthorizedException('API key has expired.');
    }

    // Check required permissions
    const requiredPermissions = this.reflector.getAllAndOverride<
      string[] | undefined
    >(API_KEY_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    if (requiredPermissions && requiredPermissions.length > 0) {
      const keyPerms = apiKey.permissions as string[];
      const missing = requiredPermissions.filter((p) => !keyPerms.includes(p));
      if (missing.length > 0) {
        throw new ForbiddenException(
          `API key lacks required permissions: ${missing.join(', ')}`,
        );
      }
    }

    // Update lastUsedAt (fire-and-forget to avoid slowing the request)
    this.prisma.apiKey
      .update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      })
      .catch((err: Error) => {
        this.logger.warn(
          `Failed to update lastUsedAt for API key ${apiKey.id}: ${err.message}`,
        );
      });

    // Attach a synthetic user object for downstream guards
    // (TenantGuard reads organizationId, SubscriptionGuard reads organizationId)
    (request as unknown as Record<string, unknown>)['user'] = {
      sub: apiKey.userId,
      email: apiKey.user.email,
      organizationId: apiKey.organizationId,
      isApiKey: true,
      apiKeyId: apiKey.id,
      apiKeyPermissions: apiKey.permissions,
    };

    return true;
  }
}
