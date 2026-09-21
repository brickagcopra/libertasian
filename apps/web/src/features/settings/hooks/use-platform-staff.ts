'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  PermissionCatalogue,
  PlatformGrant,
  PlatformRoleDetail,
  PlatformRoleSummary,
  PlatformStaffCandidate,
} from '@libertasian/types';

import { rbacKeys } from './use-rbac';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const platformKeys = {
  all: ['platform'] as const,
  staff: (params?: { cursor?: string; limit?: number }) =>
    [...platformKeys.all, 'staff', params ?? {}] as const,
  candidates: (q: string) => [...platformKeys.all, 'candidates', q] as const,
  roles: () => [...platformKeys.all, 'roles'] as const,
  role: (id: string) => [...platformKeys.all, 'roles', id] as const,
  permissionCatalogue: () => [...platformKeys.all, 'permissions'] as const,
};

/**
 * Everything the staff panel writes changes who can do what, so a mutation
 * invalidates the staff list, the role list AND the caller's own permissions
 * — an admin who edits a role they hold is looking at a stale gate otherwise.
 */
function useInvalidatePlatform() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: platformKeys.all });
    queryClient.invalidateQueries({ queryKey: rbacKeys.myPermissions() });
    // Grants and revokes change who may be assigned a digest.
    queryClient.invalidateQueries({ queryKey: ['admin', 'digest-reviewers'] });
  };
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export function usePlatformStaff(params?: { cursor?: string; limit?: number }) {
  return useQuery({
    queryKey: platformKeys.staff(params),
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (params?.cursor) queryParams['cursor'] = params.cursor;
      if (params?.limit) queryParams['limit'] = String(params.limit);
      const res = await apiClient.get<{
        success: boolean;
        data: PlatformGrant[];
        meta: { hasNext: boolean; nextCursor?: string; limit: number };
      }>('/platform/staff', { params: queryParams });
      return { items: res.data, meta: res.meta };
    },
  });
}

/**
 * Search EXISTING accounts. The API never creates a user and never sends an
 * invitation — if a person has no account they sign up themselves first — so
 * an empty result means exactly that, not "we'll invite them".
 */
export function useStaffCandidates(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: platformKeys.candidates(q),
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: PlatformStaffCandidate[];
      }>('/platform/staff/candidates', { params: { q, limit: '10' } });
      return res.data;
    },
    enabled: q.length >= 2,
  });
}

export function useGrantPlatformRole() {
  const invalidate = useInvalidatePlatform();
  return useMutation({
    mutationFn: async ({
      userId,
      roleDefinitionId,
      expiresAt,
    }: {
      userId: string;
      roleDefinitionId: string;
      expiresAt?: string;
    }) => {
      const res = await apiClient.post<{ success: boolean; data: PlatformGrant }>(
        `/platform/staff/${userId}/roles`,
        { roleDefinitionId, ...(expiresAt ? { expiresAt } : {}) },
      );
      return res.data;
    },
    onSuccess: invalidate,
  });
}

export function useRevokePlatformRole() {
  const invalidate = useInvalidatePlatform();
  return useMutation({
    mutationFn: async ({
      userId,
      roleDefinitionId,
    }: {
      userId: string;
      roleDefinitionId: string;
    }) => {
      await apiClient.delete(
        `/platform/staff/${userId}/roles/${roleDefinitionId}`,
      );
    },
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Platform roles
// ---------------------------------------------------------------------------

/**
 * Platform-grantable roles, loaded at runtime. A role created in the panel
 * appears here with no deploy — nothing about the role set is compiled in.
 */
export function usePlatformRoles() {
  return useQuery({
    queryKey: platformKeys.roles(),
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: PlatformRoleSummary[];
      }>('/platform/roles');
      return res.data;
    },
  });
}

export function usePlatformRole(id: string | null) {
  return useQuery({
    queryKey: platformKeys.role(id ?? ''),
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: PlatformRoleDetail;
      }>(`/platform/roles/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

/** The permission catalogue the picker is rendered from. */
export function usePermissionCatalogue() {
  return useQuery({
    queryKey: platformKeys.permissionCatalogue(),
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: PermissionCatalogue;
      }>('/platform/permissions');
      return res.data;
    },
    staleTime: 10 * 60 * 1000, // the catalogue only changes with a migration
  });
}

export interface PlatformRoleInput {
  name: string;
  slug: string;
  description?: string;
  permissionIds: string[];
  maxPerOrg?: number;
}

export function useCreatePlatformRole() {
  const invalidate = useInvalidatePlatform();
  return useMutation({
    mutationFn: async (input: PlatformRoleInput) => {
      const res = await apiClient.post<{
        success: boolean;
        data: PlatformRoleDetail;
      }>('/platform/roles', input);
      return res.data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdatePlatformRole() {
  const invalidate = useInvalidatePlatform();
  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: Partial<Omit<PlatformRoleInput, 'slug'>> & { id: string }) => {
      const res = await apiClient.patch<{
        success: boolean;
        data: PlatformRoleDetail;
      }>(`/platform/roles/${id}`, input);
      return res.data;
    },
    onSuccess: invalidate,
  });
}

export function useDeletePlatformRole() {
  const invalidate = useInvalidatePlatform();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/platform/roles/${id}`);
    },
    onSuccess: invalidate,
  });
}

/**
 * The server's refusal, verbatim.
 *
 * Escalation, separation of duties, cardinality and last-admin refusals are
 * written to teach the operator the rule they just hit ("…confers 6
 * permission(s) you do not hold — admin:billing, admin:users, …"). Replacing
 * them with "Something went wrong" throws that away, so every surface in this
 * panel renders this string as-is.
 */
export function serverMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Request failed.';
}
