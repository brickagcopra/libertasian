import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Variant of JwtAuthGuard that does NOT throw when the bearer token is
 * missing or invalid. Returns `null` for the authenticated user so the
 * route stays public, while a valid token still hydrates `req.user` as
 * usual. Use this on public read endpoints that need to branch on
 * subscription entitlements when a user happens to be signed in.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  override handleRequest<T>(
    _err: Error | null,
    user: T | false,
    _info: unknown,
    _context: ExecutionContext,
  ): T | null {
    return user ? user : null;
  }
}
