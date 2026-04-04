'use client';

import type { ReactNode } from 'react';

import { useHasPermission } from '@/features/settings/hooks/use-rbac';

interface PermissionGateProps {
  /** Permission code(s) to check. */
  permissions: string | string[];
  /** 'all' requires every permission, 'any' requires at least one. Default: 'all'. */
  mode?: 'all' | 'any';
  /** Content shown when permission is granted. */
  children: ReactNode;
  /** Optional fallback shown when permission is denied. */
  fallback?: ReactNode;
  /** If true, render nothing while permissions are loading. Default: true. */
  hideWhileLoading?: boolean;
}

/**
 * Conditionally renders children based on the current user's effective RBAC permissions.
 *
 * @example
 * <PermissionGate permissions="roles:read">
 *   <AdminPanel />
 * </PermissionGate>
 *
 * @example
 * <PermissionGate permissions={['documents:create', 'documents:update']} mode="any">
 *   <EditButton />
 * </PermissionGate>
 */
export function PermissionGate({
  permissions,
  mode = 'all',
  children,
  fallback = null,
  hideWhileLoading = true,
}: PermissionGateProps) {
  const { hasPermission, isLoading } = useHasPermission(permissions, mode);

  if (isLoading) {
    return hideWhileLoading ? null : <>{fallback}</>;
  }

  return hasPermission ? <>{children}</> : <>{fallback}</>;
}
