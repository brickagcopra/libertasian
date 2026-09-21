import { SetMetadata } from '@nestjs/common';

import type { PermissionMatchMode } from './permissions.decorator';

/**
 * Metadata key for PLATFORM permission requirements.
 *
 * Deliberately distinct from PERMISSIONS_KEY. Tenant permissions resolve from
 * an organization member; platform permissions resolve from a user with no
 * organization at all. Sharing one key would let PermissionsGuard try to
 * satisfy a platform requirement out of the caller's personal workspace —
 * which is exactly the confusion this model exists to end.
 */
export const PLATFORM_PERMISSIONS_KEY = 'requiredPlatformPermissions';

export interface PlatformPermissionsMetadata {
  permissions: string[];
  mode: PermissionMatchMode;
}

/**
 * Require platform (organization-less) permissions for an endpoint.
 *
 * Usage:
 *   @RequiredPlatformPermissions('platform-staff:manage')
 *   @RequiredPlatformPermissions({ permissions: ['a', 'b'], mode: 'any' })
 *
 * Only meaningful on a controller guarded by PlatformPermissionsGuard.
 */
export function RequiredPlatformPermissions(
  ...args: string[] | [{ permissions: string[]; mode: PermissionMatchMode }]
): MethodDecorator & ClassDecorator {
  const first = args[0];
  const metadata: PlatformPermissionsMetadata =
    args.length === 1 && typeof first === 'object' && 'permissions' in first
      ? first
      : { permissions: args as string[], mode: 'all' };

  return SetMetadata(PLATFORM_PERMISSIONS_KEY, metadata);
}
