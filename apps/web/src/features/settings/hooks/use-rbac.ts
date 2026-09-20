'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import type {
  MyPermissions,
  PermissionDef,
  RoleDefinitionDto,
  RoleHierarchyNode,
  RoleHierarchyEdge,
  RbacConstraint,
  MemberWithRoles,
  MemberRoleAssignment,
} from '@libertasian/types';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const rbacKeys = {
  all: ['rbac'] as const,
  permissions: (params?: { category?: string; resource?: string }) =>
    [...rbacKeys.all, 'permissions', params ?? {}] as const,
  roles: (params?: { systemOnly?: boolean }) =>
    [...rbacKeys.all, 'roles', params ?? {}] as const,
  role: (id: string) => [...rbacKeys.all, 'roles', id] as const,
  hierarchy: () => [...rbacKeys.all, 'hierarchy'] as const,
  constraints: () => [...rbacKeys.all, 'constraints'] as const,
  members: (params?: { cursor?: string; limit?: number; search?: string; roleSlug?: string }) =>
    [...rbacKeys.all, 'members', params ?? {}] as const,
  memberRoles: (memberId: string) => [...rbacKeys.all, 'members', memberId, 'roles'] as const,
  memberPermissions: (memberId: string) =>
    [...rbacKeys.all, 'members', memberId, 'permissions'] as const,
  myPermissions: () => [...rbacKeys.all, 'my-permissions'] as const,
  auditLogs: (params?: Record<string, unknown>) =>
    [...rbacKeys.all, 'audit-logs', params ?? {}] as const,
};

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export function usePermissions(params?: { category?: string; resource?: string }) {
  return useQuery({
    queryKey: rbacKeys.permissions(params),
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (params?.category) queryParams['category'] = params.category;
      if (params?.resource) queryParams['resource'] = params.resource;
      const res = await apiClient.get<{ success: boolean; data: PermissionDef[] }>(
        '/rbac/permissions',
        { params: queryParams },
      );
      return res.data;
    },
  });
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export function useRoles(params?: { systemOnly?: boolean }) {
  return useQuery({
    queryKey: rbacKeys.roles(params),
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (params?.systemOnly) queryParams['systemOnly'] = 'true';
      const res = await apiClient.get<{ success: boolean; data: RoleDefinitionDto[] }>(
        '/rbac/roles',
        { params: queryParams },
      );
      return res.data;
    },
  });
}

export function useRole(id: string) {
  return useQuery({
    queryKey: rbacKeys.role(id),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: RoleDefinitionDto }>(
        `/rbac/roles/${id}`,
      );
      return res.data;
    },
    enabled: !!id,
  });
}

export function useRoleHierarchy() {
  return useQuery({
    queryKey: rbacKeys.hierarchy(),
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: { tree: RoleHierarchyNode[]; edges: RoleHierarchyEdge[] };
      }>('/rbac/hierarchy');
      return res.data;
    },
  });
}

export function useConstraints() {
  return useQuery({
    queryKey: rbacKeys.constraints(),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: RbacConstraint[] }>(
        '/rbac/constraints',
      );
      return res.data;
    },
  });
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

interface ListMembersParams {
  cursor?: string;
  limit?: number;
  search?: string;
  roleSlug?: string;
}

interface MembersResponse {
  items: MemberWithRoles[];
  meta: { hasNext: boolean; nextCursor?: string; limit: number };
}

export function useRbacMembers(params?: ListMembersParams) {
  return useQuery({
    queryKey: rbacKeys.members(params),
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (params?.cursor) queryParams['cursor'] = params.cursor;
      if (params?.limit) queryParams['limit'] = String(params.limit);
      if (params?.search) queryParams['search'] = params.search;
      if (params?.roleSlug) queryParams['roleSlug'] = params.roleSlug;
      const res = await apiClient.get<{
        success: boolean;
        data: MemberWithRoles[];
        meta: { hasNext: boolean; nextCursor?: string; limit: number };
      }>('/rbac/members', { params: queryParams });
      return { items: res.data, meta: res.meta } as MembersResponse;
    },
  });
}

export function useMemberRoles(memberId: string) {
  return useQuery({
    queryKey: rbacKeys.memberRoles(memberId),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: MemberRoleAssignment[] }>(
        `/rbac/members/${memberId}/roles`,
      );
      return res.data;
    },
    enabled: !!memberId,
  });
}

export function useMemberEffectivePermissions(memberId: string) {
  return useQuery({
    queryKey: rbacKeys.memberPermissions(memberId),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: string[] }>(
        `/rbac/members/${memberId}/permissions`,
      );
      return res.data;
    },
    enabled: !!memberId,
  });
}

// ---------------------------------------------------------------------------
// Current user permissions
// ---------------------------------------------------------------------------

/**
 * The caller's own effective access, in ONE request.
 *
 * This used to be a two-hop lookup: GET /rbac/members (gated on
 * `members:read`) to find the caller's own member id, then
 * GET /rbac/members/:id/permissions. Roles that legitimately hold no
 * `members:read` — reviewer, editor — got 403 on the first hop, fell through
 * to `[]`, and PermissionGate then denied them every surface in the product,
 * including the review queue they exist to work.
 *
 * GET /rbac/me/permissions needs no permission at all (the Kubernetes
 * SelfSubjectRulesReview pattern): asking what you can do must never require
 * permission to ask.
 */
export function useMyPermissions() {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: rbacKeys.myPermissions(),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: MyPermissions }>(
        '/rbac/me/permissions',
      );
      return res.data;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 minutes — matches the Redis RBAC cache TTL
  });
}

/**
 * Back-compat alias. Returns the flat code list the old hook returned, so
 * callers that only want "can I do X" keep working unchanged.
 *
 * @deprecated Prefer useMyPermissions() when you need the tenant/platform
 * split or the platformMember flag.
 */
export function useCurrentUserPermissions() {
  const query = useMyPermissions();
  return { ...query, data: query.data ? flattenPermissions(query.data) : undefined };
}

/**
 * Tenant and platform codes in one list, for RENDERING decisions only.
 *
 * The server keeps them apart because they answer different questions, and no
 * server-side gate is ever satisfied from this union — every surface it
 * reveals still has its own guard, and that guard is the real control (P3).
 * Merging here only means the UI stops hiding a button from someone who holds
 * the permission on the org that actually matters for it.
 */
function flattenPermissions(me: MyPermissions): string[] {
  return [...new Set([...me.permissions, ...me.platformPermissions])];
}

/**
 * Check if the current user has a specific permission or set of permissions.
 * @param permissions - Single code or array of permission codes
 * @param mode - 'all' (default) requires all permissions, 'any' requires at least one
 */
export function useHasPermission(
  permissions: string | string[],
  mode: 'all' | 'any' = 'all',
): { hasPermission: boolean; isLoading: boolean } {
  const { data: me, isLoading } = useMyPermissions();

  if (isLoading || !me) {
    return { hasPermission: false, isLoading };
  }

  const held = flattenPermissions(me);
  const codes = Array.isArray(permissions) ? permissions : [permissions];
  const hasPermission =
    mode === 'all'
      ? codes.every((code) => held.includes(code))
      : codes.some((code) => held.includes(code));

  return { hasPermission, isLoading: false };
}

/**
 * Platform-staff codes only — what the admin surfaces gate on.
 *
 * Deliberately NOT the union: an admin entry must never be unlocked by a
 * permission the caller holds on their own personal workspace (P2).
 */
export function useHasPlatformPermission(
  permissions: string | string[],
  mode: 'all' | 'any' = 'any',
): { hasPermission: boolean; isLoading: boolean } {
  const { data: me, isLoading } = useMyPermissions();

  if (isLoading || !me) {
    return { hasPermission: false, isLoading };
  }

  const codes = Array.isArray(permissions) ? permissions : [permissions];
  const hasPermission =
    mode === 'all'
      ? codes.every((code) => me.platformPermissions.includes(code))
      : codes.some((code) => me.platformPermissions.includes(code));

  return { hasPermission, isLoading: false };
}

// ---------------------------------------------------------------------------
// Role CRUD mutations
// ---------------------------------------------------------------------------

interface CreateCustomRoleInput {
  name: string;
  slug: string;
  description?: string;
  permissionIds: string[];
  requiresMfa?: boolean;
  maxPerOrg?: number;
}

interface UpdateCustomRoleInput {
  name?: string;
  description?: string;
  permissionIds?: string[];
  requiresMfa?: boolean;
  maxPerOrg?: number;
}

export function useCreateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCustomRoleInput) => {
      const res = await apiClient.post<{ success: boolean; data: RoleDefinitionDto }>(
        '/rbac/roles',
        input,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...rbacKeys.all, 'roles'] });
    },
  });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateCustomRoleInput & { id: string }) => {
      const res = await apiClient.patch<{ success: boolean; data: RoleDefinitionDto }>(
        `/rbac/roles/${id}`,
        input,
      );
      return res.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...rbacKeys.all, 'roles'] });
      queryClient.invalidateQueries({ queryKey: rbacKeys.role(variables.id) });
      // Invalidate all member permissions since role definition changed
      queryClient.invalidateQueries({ queryKey: rbacKeys.myPermissions() });
    },
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/rbac/roles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...rbacKeys.all, 'roles'] });
      queryClient.invalidateQueries({ queryKey: rbacKeys.myPermissions() });
    },
  });
}

// ---------------------------------------------------------------------------
// Member role mutations
// ---------------------------------------------------------------------------

export function useAssignRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      memberId,
      roleDefinitionId,
      expiresAt,
    }: {
      memberId: string;
      roleDefinitionId: string;
      expiresAt?: string;
    }) => {
      const res = await apiClient.post<{ success: boolean; data: MemberRoleAssignment }>(
        `/rbac/members/${memberId}/roles`,
        { roleDefinitionId, ...(expiresAt ? { expiresAt } : {}) },
      );
      return res.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: rbacKeys.memberRoles(variables.memberId) });
      queryClient.invalidateQueries({
        queryKey: rbacKeys.memberPermissions(variables.memberId),
      });
      queryClient.invalidateQueries({ queryKey: [...rbacKeys.all, 'members'] });
    },
  });
}

export function useRemoveRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      memberId,
      roleDefinitionId,
    }: {
      memberId: string;
      roleDefinitionId: string;
    }) => {
      await apiClient.delete(`/rbac/members/${memberId}/roles/${roleDefinitionId}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: rbacKeys.memberRoles(variables.memberId) });
      queryClient.invalidateQueries({
        queryKey: rbacKeys.memberPermissions(variables.memberId),
      });
      queryClient.invalidateQueries({ queryKey: [...rbacKeys.all, 'members'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Audit logs (RBAC-scoped — entity types: member_role, role_definition)
// ---------------------------------------------------------------------------

interface AuditLogItem {
  id: string;
  organizationId: string;
  actorUserId: string;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string;
  metadataJson: Record<string, unknown>;
  createdAt: string;
}

interface ListAuditLogsParams {
  cursor?: string;
  limit?: number;
  action?: string[];
  actorUserId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function useRbacAuditLogs(params?: ListAuditLogsParams) {
  return useQuery({
    queryKey: rbacKeys.auditLogs(params as Record<string, unknown>),
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (params?.cursor) queryParams['cursor'] = params.cursor;
      if (params?.limit) queryParams['limit'] = String(params.limit);
      if (params?.actorUserId) queryParams['actorUserId'] = params.actorUserId;
      if (params?.dateFrom) queryParams['dateFrom'] = params.dateFrom;
      if (params?.dateTo) queryParams['dateTo'] = params.dateTo;
      if (params?.action) {
        params.action.forEach((a) => {
          queryParams[`action`] = a;
        });
      }
      const res = await apiClient.get<{
        success: boolean;
        data: AuditLogItem[];
        meta: { hasNext: boolean; nextCursor?: string; limit: number };
      }>('/rbac/audit-logs', { params: queryParams });
      return { items: res.data, meta: res.meta };
    },
  });
}

// ---------------------------------------------------------------------------
// Audit logs (full org-wide — all entity types)
// ---------------------------------------------------------------------------

export interface FullAuditLogItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorUserId: string;
  actorType: string;
  actorName: string | null;
  actorEmail: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ListAllAuditLogsParams {
  cursor?: string;
  limit?: number;
  action?: string[];
  entityType?: string[];
  actorUserId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export const auditKeys = {
  all: ['audit-logs'] as const,
  list: (params?: Record<string, unknown>) =>
    [...auditKeys.all, 'list', params ?? {}] as const,
  entityTypes: () => [...auditKeys.all, 'entity-types'] as const,
  actions: () => [...auditKeys.all, 'actions'] as const,
};

export function useAuditLogs(params?: ListAllAuditLogsParams) {
  return useQuery({
    queryKey: auditKeys.list(params as Record<string, unknown>),
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (params?.cursor) queryParams['cursor'] = params.cursor;
      if (params?.limit) queryParams['limit'] = String(params.limit);
      if (params?.actorUserId) queryParams['actorUserId'] = params.actorUserId;
      if (params?.dateFrom) queryParams['dateFrom'] = params.dateFrom;
      if (params?.dateTo) queryParams['dateTo'] = params.dateTo;
      // For array params, join with comma — backend Transform handles both formats
      if (params?.action?.length) queryParams['action'] = params.action.join(',');
      if (params?.entityType?.length) queryParams['entityType'] = params.entityType.join(',');
      const res = await apiClient.get<{
        success: boolean;
        data: FullAuditLogItem[];
        meta: { hasNext: boolean; nextCursor?: string };
      }>('/audit-logs', { params: queryParams });
      return { items: res.data, meta: res.meta };
    },
  });
}

export function useAuditEntityTypes() {
  return useQuery({
    queryKey: auditKeys.entityTypes(),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: string[] }>(
        '/audit-logs/entity-types',
      );
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useAuditActions() {
  return useQuery({
    queryKey: auditKeys.actions(),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: string[] }>(
        '/audit-logs/actions',
      );
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useExportAuditLogsCsv() {
  return useMutation({
    mutationFn: async (params?: ListAllAuditLogsParams) => {
      const queryParams: Record<string, string> = {};
      if (params?.action?.length) queryParams['action'] = params.action.join(',');
      if (params?.entityType?.length) queryParams['entityType'] = params.entityType.join(',');
      if (params?.actorUserId) queryParams['actorUserId'] = params.actorUserId;
      if (params?.dateFrom) queryParams['dateFrom'] = params.dateFrom;
      if (params?.dateTo) queryParams['dateTo'] = params.dateTo;

      const res = await apiClient.get<string>('/audit-logs/export', {
        params: queryParams,
      });
      return res as unknown as string;
    },
  });
}
