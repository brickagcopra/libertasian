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

// TODO(rbac): replace this hardcoded list with `role_definitions.requires_mfa`,
// which every seeded role already sets, resolved through the roles the caller
// actually holds (member_roles for tenant, platform_role_grants for platform).
// This list reads the LEGACY `organization_members.role` string column off the
// JWT, which the RBAC APIs never write — so a role granted in a panel can
// never trigger it. It is inert today because MFA is off; it must not outlive
// that, since a role-name string literal in an authorization decision is
// exactly what the platform-grants model removes everywhere else.
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
