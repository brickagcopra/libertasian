import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guard for internal service-to-service endpoints. Validates the
 * `X-Internal-Auth` header against the `INTERNAL_API_KEY` env var.
 *
 * This is NOT a JWT guard — it's a shared-secret check for Python
 * worker-service -> NestJS internal calls.
 */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = request.headers['x-internal-auth'];
    const expected = this.config.get<string>('INTERNAL_API_KEY');

    if (!expected || !token || token !== expected) {
      throw new UnauthorizedException('Invalid internal auth token');
    }

    return true;
  }
}
