import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * MfaGuard enforces MFA verification for privileged roles.
 * Per CLAUDE.md: "Enforce MFA for admin/editor/reviewer roles."
 *
 * Must run AFTER JwtAuthGuard (needs user in request).
 * For roles that don't require MFA, this guard passes through.
 */

const MFA_REQUIRED_ROLES = ['owner', 'admin', 'editor', 'reviewer'];

@Injectable()
export class MfaGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as
      | { role?: string; mfaVerified?: boolean }
      | undefined;

    if (!user) {
      // No user attached — let JwtAuthGuard handle this
      return true;
    }

    if (
      user.role &&
      MFA_REQUIRED_ROLES.includes(user.role) &&
      !user.mfaVerified
    ) {
      throw new ForbiddenException(
        'Multi-factor authentication is required for this role. Please enable and verify MFA.',
      );
    }

    return true;
  }
}
