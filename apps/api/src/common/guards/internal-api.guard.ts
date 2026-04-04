import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Guard for internal service-to-service endpoints.
 * Validates `X-Internal-Api-Key` header against the INTERNAL_API_KEY env var.
 *
 * Used by worker-service to call NestJS endpoints (e.g., OpenSearch indexing
 * after auto-publish). No JWT required — these are server-to-server calls.
 */
@Injectable()
export class InternalApiGuard implements CanActivate {
  private readonly logger = new Logger(InternalApiGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const headerKey = request.headers['x-internal-api-key'] as
      | string
      | undefined;

    if (!headerKey) {
      throw new UnauthorizedException('Missing X-Internal-Api-Key header.');
    }

    const expectedKey = this.config.get<string>('INTERNAL_API_KEY');
    if (!expectedKey) {
      this.logger.error(
        'INTERNAL_API_KEY env var is not set — all internal API calls will fail.',
      );
      throw new UnauthorizedException('Internal API is not configured.');
    }

    if (headerKey !== expectedKey) {
      throw new UnauthorizedException('Invalid internal API key.');
    }

    return true;
  }
}
