import { SetMetadata } from '@nestjs/common';

export const ALLOW_DISPLACED_SESSION_KEY = 'allowDisplacedSession';

/**
 * Lets a session that lost its concurrent-use slot still reach this route
 * (JwtAuthGuard skips the `session_displaced` check). For the routes a
 * displaced device needs to recover: claim the slot back, list / revoke
 * sessions, log out.
 */
export const AllowDisplacedSession = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_DISPLACED_SESSION_KEY, true);
