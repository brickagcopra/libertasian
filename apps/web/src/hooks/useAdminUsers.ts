'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export interface AdminUserListItem {
  id: string;
  email: string;
  fullName: string;
  status: string;
  userRole: string | null;
  emailVerified: boolean;
  mfaEnabled: boolean;
  createdAt: string;
  primaryOrgName: string | null;
  currentPlanCode: string | null;
  subscriptionStatus: string | null;
  subscriptionStartedAt: string | null;
  lifetimeValueCentavos: number;
}

export interface AdminUserListResponse {
  success: boolean;
  data: AdminUserListItem[];
  nextCursor: string | null;
  hasNext: boolean;
}

export interface ListAdminUsersQuery {
  search?: string;
  status?: string;
  role?: string;
  planTier?: string;
  hasActiveSubscription?: boolean;
  sortBy?: 'createdAt' | 'email';
  sortDir?: 'asc' | 'desc';
  limit?: number;
}

export const adminUsersKeys = {
  all: ['admin', 'users'] as const,
  list: (params?: ListAdminUsersQuery) =>
    [...adminUsersKeys.all, 'list', params ?? {}] as const,
  detail: (id: string) => [...adminUsersKeys.all, 'detail', id] as const,
};

function buildSearchParams(
  params: ListAdminUsersQuery,
  cursor: string | undefined,
): string {
  const sp = new URLSearchParams();
  if (cursor) sp.set('cursor', cursor);
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.search) sp.set('search', params.search);
  if (params.status) sp.set('status', params.status);
  if (params.role) sp.set('role', params.role);
  if (params.planTier) sp.set('planTier', params.planTier);
  if (params.hasActiveSubscription !== undefined)
    sp.set('hasActiveSubscription', String(params.hasActiveSubscription));
  if (params.sortBy) sp.set('sortBy', params.sortBy);
  if (params.sortDir) sp.set('sortDir', params.sortDir);
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

export function useAdminUsers(params: ListAdminUsersQuery = {}) {
  return useInfiniteQuery({
    queryKey: adminUsersKeys.list(params),
    queryFn: async ({ pageParam }) => {
      const qs = buildSearchParams(params, pageParam as string | undefined);
      return apiClient.get<AdminUserListResponse>(`/admin/users${qs}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasNext ? (lastPage.nextCursor ?? undefined) : undefined,
    staleTime: 2 * 60 * 1000,
  });
}
