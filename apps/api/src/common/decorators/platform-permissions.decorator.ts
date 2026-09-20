import { SetMetadata } from '@nestjs/common';

import type { PermissionsMetadata, PermissionMatchMode } from './permissions.decorator';

export const PLATFORM_PERMISSIONS_KEY = 'requiredPlatformPermissions';

/**
 * Require permissions held on the PLATFORM organization.
 *
 * The difference from @RequiredPermissions is the org the check resolves
 * against. PermissionsGuard resolves the caller's CURRENT org, which is the
 * right question for tenant surfaces and the wrong one for platform
 * administration: every self-registered user owns a personal workspace and
 * holds `owner` on it, so "has members:read somewhere" is satisfied by every
 * account on the system, and conversely a platform admin who happens to be
 * logged into a second org of their own would be refused their own staff
 * console.
 *
 * Usage mirrors @RequiredPermissions:
 *   @RequiredPlatformPermissions('members:read')
 *   @RequiredPlatformPermissions({ permissions: ['a', 'b'], mode: 'any' })
 */
export function RequiredPlatformPermissions(
  ...args: string[] | [{ permissions: string[]; mode: PermissionMatchMode }]
): MethodDecorator & ClassDecorator {
  let metadata: PermissionsMetadata;

  if (args.length === 1 && typeof args[0] === 'object' && 'permissions' in args[0]) {
    metadata = args[0];
  } else {
    metadata = { permissions: args as string[], mode: 'all' };
  }

  return SetMetadata(PLATFORM_PERMISSIONS_KEY, metadata);
}
