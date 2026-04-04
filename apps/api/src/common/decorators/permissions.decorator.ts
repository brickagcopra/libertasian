import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Match mode for permission checks:
 * - 'all': user must have ALL listed permissions (default)
 * - 'any': user must have at least ONE listed permission
 */
export type PermissionMatchMode = 'all' | 'any';

export interface PermissionsMetadata {
  permissions: string[];
  mode: PermissionMatchMode;
}

/**
 * Decorator to specify required RBAC permissions for an endpoint.
 *
 * Usage:
 *   @RequiredPermissions('documents:read')
 *   @RequiredPermissions('documents:read', 'documents:update')         // ALL required
 *   @RequiredPermissions({ permissions: ['admin:dashboard', 'admin:review-queue'], mode: 'any' })
 */
export function RequiredPermissions(
  ...args: string[] | [{ permissions: string[]; mode: PermissionMatchMode }]
): MethodDecorator & ClassDecorator {
  let metadata: PermissionsMetadata;

  if (args.length === 1 && typeof args[0] === 'object' && 'permissions' in args[0]) {
    metadata = args[0];
  } else {
    metadata = { permissions: args as string[], mode: 'all' };
  }

  return SetMetadata(PERMISSIONS_KEY, metadata);
}
