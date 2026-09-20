'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MemberWithRoles,
  PermissionDef,
  RoleDefinitionDto,
} from '@libertasian/types';

import { apiClient } from '@/lib/api-client';

/**
 * Staff administration hooks.
 *
 * Every call here targets `/rbac/platform/*`, which acts on the PLATFORM
 * organization explicitly. The tenant-scoped `/rbac/members` endpoints would
 * silently operate on whatever org the caller's token happens to carry — for
 * anyone who signed up normally, their own personal workspace — and a role
 * granted there confers nothing.
 *
 * No role names are hardcoded: the grantable roles come from
 * `usePlatformRoles()` at runtime, so a role created in the panel is
 * immediately grantable with no deploy.
 */

export const platformStaffKeys = {
  all: ['platform-staff'] as const,
  members: (params?: Record<string, unknown>) =>
    [...platformStaffKeys.all, 'members', params ?? {}] as const,
  roles: () => [...platformStaffKeys.all, 'roles'] as const,
  permissions: () => [...platformStaffKeys.all, 'permissions'] as const,
  auditLogs: (params?: Record<string, unknown>) =>
    [...platformStaffKeys.all, 'audit-logs', params ?? {}] as const,
};

/** A platform member, with the permissions their roles actually resolve to. */
export interface PlatformStaffMember extends MemberWithRoles {
  effectivePermissions: string[];
}

interface ListParams {
  cursor?: string;
  limit?: number;
  search?: string;
  roleSlug?: string;
}

export function usePlatformStaff(params?: ListParams) {
  return useQuery({
    queryKey: platformStaffKeys.members(params as Record<string, unknown>),
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (params?.cursor) queryParams['cursor'] = params.cursor;
      if (params?.limit) queryParams['limit'] = String(params.limit);
      if (params?.search) queryParams['search'] = params.search;
      if (params?.roleSlug) queryParams['roleSlug'] = params.roleSlug;

      const res = await apiClient.get<{
        success: boolean;
        data: PlatformStaffMember[];
        meta: { hasNext: boolean; nextCursor?: string };
      }>('/rbac/platform/members', { params: queryParams });

      return { items: res.data, meta: res.meta };
    },
  });
}

/** Roles grantable on the platform org — loaded at runtime, never hardcoded. */
export function usePlatformRoles() {
  return useQuery({
    queryKey: platformStaffKeys.roles(),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: RoleDefinitionDto[] }>(
        '/rbac/platform/roles',
      );
      return res.data;
    },
  });
}

/** The permission catalogue, for the custom-role permission picker. */
export function usePlatformPermissions() {
  return useQuery({
    queryKey: platformStaffKeys.permissions(),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: PermissionDef[] }>(
        '/rbac/platform/permissions',
      );
      return res.data;
    },
    staleTime: 10 * 60 * 1000, // The catalogue is effectively static.
  });
}

export interface PlatformAuditLogItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorUserId: string;
  metadataJson: Record<string, unknown>;
  createdAt: string;
}

export function usePlatformAuditLogs(params?: { limit?: number; cursor?: string }) {
  return useQuery({
    queryKey: platformStaffKeys.auditLogs(params as Record<string, unknown>),
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (params?.limit) queryParams['limit'] = String(params.limit);
      if (params?.cursor) queryParams['cursor'] = params.cursor;

      const res = await apiClient.get<{
        success: boolean;
        data: PlatformAuditLogItem[];
        meta: { hasNext: boolean; nextCursor?: string };
      }>('/rbac/platform/audit-logs', { params: queryParams });

      return { items: res.data, meta: res.meta };
    },
  });
}

/**
 * Invalidate everything a grant can change.
 *
 * A grant changes the member's roles AND their effective permissions AND,
 * when the caller granted it to themselves, their own nav — so the audit log
 * and the caller's own permissions are refreshed too.
 */
function useInvalidateStaff() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: platformStaffKeys.all });
    queryClient.invalidateQueries({ queryKey: ['rbac', 'my-permissions'] });
  };
}

export function useInvitePlatformMember() {
  const invalidate = useInvalidateStaff();
  return useMutation({
    mutationFn: async (input: { email: string; role: string }) => {
      const res = await apiClient.post<{ success: boolean; data: unknown }>(
        '/rbac/platform/members/invite',
        input,
      );
      return res.data;
    },
    onSuccess: invalidate,
  });
}

export function useGrantPlatformRole() {
  const invalidate = useInvalidateStaff();
  return useMutation({
    mutationFn: async (input: {
      memberId: string;
      roleDefinitionId: string;
      /** ISO 8601. Omit for a permanent grant. */
      expiresAt?: string;
    }) => {
      const res = await apiClient.post<{ success: boolean; data: unknown }>(
        `/rbac/platform/members/${input.memberId}/roles`,
        {
          roleDefinitionId: input.roleDefinitionId,
          ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        },
      );
      return res.data;
    },
    onSuccess: invalidate,
  });
}

export function useRevokePlatformRole() {
  const invalidate = useInvalidateStaff();
  return useMutation({
    mutationFn: async (input: { memberId: string; roleDefinitionId: string }) => {
      await apiClient.delete(
        `/rbac/platform/members/${input.memberId}/roles/${input.roleDefinitionId}`,
      );
    },
    onSuccess: invalidate,
  });
}

export function useCreatePlatformRole() {
  const invalidate = useInvalidateStaff();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      slug: string;
      description?: string;
      permissionIds: string[];
    }) => {
      const res = await apiClient.post<{ success: boolean; data: RoleDefinitionDto }>(
        '/rbac/platform/roles',
        input,
      );
      return res.data;
    },
    onSuccess: invalidate,
  });
}
