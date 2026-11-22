import { ExecutionContext, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { JwtPayload } from '@libertasian/types';

import { SessionConcurrencyService } from '../../modules/auth/session-concurrency/session-concurrency.service';
import { ALLOW_DISPLACED_SESSION_KEY } from '../decorators/allow-displaced-session.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    @Optional() private readonly concurrency?: SessionConcurrencyService,
    @Optional() private readonly reflector?: Reflector,
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowed = (await super.canActivate(context)) as boolean;
    if (!allowed || !this.concurrency?.isEnabled() || context.getType() !== 'http') {
      return allowed;
    }
    const exempt = this.reflector?.getAllAndOverride<boolean>(ALLOW_DISPLACED_SESSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (exempt) return allowed;

    // Throws 409 session_displaced when this session lost its slot.
    const req = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    await this.concurrency.assertActive(req.user);
    return allowed;
  }

  override handleRequest<T>(err: Error | null, user: T, info: unknown, _context: ExecutionContext): T {
    if (err || !user) {
      throw err || new UnauthorizedException('Invalid or expired token');
    }
    return user;
  }
}
