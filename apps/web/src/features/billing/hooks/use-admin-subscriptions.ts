'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  AdminSubscriptionListResponse,
  AdminSubscriptionDetail,
  AdminSubscriptionDetailResponse,
  SubscriptionHistoryListResponse,
  SubscriptionMigrationListResponse,
  EntitlementOverrideListResponse,
  ListSubscriptionsQuery,
  ListSubscriptionHistoryQuery,
  ListSubscriptionMigrationsQuery,
  ListEntitlementOverridesQuery,
  ForceCancelInput,
  ExtendTrialInput,
  ChangeBillingPeriodInput,
  GrantComplimentaryInput,
  RevokeComplimentaryInput,
  GrantEntitlementOverrideInput,
  RevokeEntitlementOverrideInput,
  EffectiveEntitlementReport,
  EffectiveEntitlementsResponse,
  EntitlementPlatform,
  StoredEntitlementKeyStats,
  StoredEntitlementKeyCountsResponse,
  SetEntitlementsJsonInput,
  PruneEntitlementsJsonInput,
  PruneEntitlementsJsonResult,
  PruneEntitlementsJsonResponse,
} from '../types';

// ─── Query Keys ──────────────────────────────────────────

export const adminSubscriptionKeys = {
  all: ['admin', 'subscriptions'] as const,
  list: (params?: ListSubscriptionsQuery) =>
    [...adminSubscriptionKeys.all, 'list', params ?? {}] as const,
  detail: (id: string) =>
    [...adminSubscriptionKeys.all, 'detail', id] as const,
  history: (id: string, params?: ListSubscriptionHistoryQuery) =>
    [...adminSubscriptionKeys.all, 'history', id, params ?? {}] as const,
  migrations: (id: string, params?: ListSubscriptionMigrationsQuery) =>
    [...adminSubscriptionKeys.all, 'migrations', id, params ?? {}] as const,
  entitlementOverrides: (params: ListEntitlementOverridesQuery) =>
    [...adminSubscriptionKeys.all, 'entitlement-overrides', params] as const,
  // The platform is part of the key on purpose — see useEffectiveEntitlements.
  effectiveEntitlements: (id: string, platform: EntitlementPlatform) =>
    [...adminSubscriptionKeys.all, 'effective-entitlements', id, platform] as const,
  storedEntitlementKeyCounts: (planCode?: string) =>
    [...adminSubscriptionKeys.all, 'stored-entitlement-key-counts', planCode ?? null] as const,
};

// ─── Queries ─────────────────────────────────────────────

/** Fetch paginated list of subscriptions with optional filters */
export function useAdminSubscriptions(params?: ListSubscriptionsQuery) {
  return useQuery({
    queryKey: adminSubscriptionKeys.list(params),
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.cursor) searchParams.set('cursor', params.cursor);
      if (params?.limit) searchParams.set('limit', String(params.limit));
      if (params?.search) searchParams.set('search', params.search);
      if (params?.status) searchParams.set('status', params.status);
      if (params?.planCode) searchParams.set('planCode', params.planCode);
      if (params?.organizationId) searchParams.set('organizationId', params.organizationId);

      const qs = searchParams.toString();
      const url = `/admin/subscriptions${qs ? `?${qs}` : ''}`;
      return apiClient.get<AdminSubscriptionListResponse>(url);
    },
    staleTime: 2 * 60 * 1000,
  });
}

/** Fetch a single subscription with full detail */
export function useAdminSubscription(id: string) {
  return useQuery({
    queryKey: adminSubscriptionKeys.detail(id),
    queryFn: async (): Promise<AdminSubscriptionDetail> => {
      const res = await apiClient.get<AdminSubscriptionDetailResponse>(
        `/admin/subscriptions/${id}`,
      );
      return res.data;
    },
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

/** Fetch paginated subscription history */
export function useSubscriptionHistory(
  subscriptionId: string,
  params?: ListSubscriptionHistoryQuery,
) {
  return useQuery({
    queryKey: adminSubscriptionKeys.history(subscriptionId, params),
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.cursor) searchParams.set('cursor', params.cursor);
      if (params?.limit) searchParams.set('limit', String(params.limit));
      if (params?.action) searchParams.set('action', params.action);
      if (params?.actorType) searchParams.set('actorType', params.actorType);

      const qs = searchParams.toString();
      const url = `/admin/subscriptions/${subscriptionId}/history${qs ? `?${qs}` : ''}`;
      return apiClient.get<SubscriptionHistoryListResponse>(url);
    },
    enabled: !!subscriptionId,
    staleTime: 60 * 1000,
  });
}

/** Fetch paginated subscription migrations */
export function useSubscriptionMigrations(
  subscriptionId: string,
  params?: ListSubscriptionMigrationsQuery,
) {
  return useQuery({
    queryKey: adminSubscriptionKeys.migrations(subscriptionId, params),
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.cursor) searchParams.set('cursor', params.cursor);
      if (params?.limit) searchParams.set('limit', String(params.limit));

      const qs = searchParams.toString();
      const url = `/admin/subscriptions/${subscriptionId}/migrations${qs ? `?${qs}` : ''}`;
      return apiClient.get<SubscriptionMigrationListResponse>(url);
    },
    enabled: !!subscriptionId,
    staleTime: 60 * 1000,
  });
}

/** Fetch paginated entitlement overrides for an organization */
export function useEntitlementOverrides(params: ListEntitlementOverridesQuery) {
  return useQuery({
    queryKey: adminSubscriptionKeys.entitlementOverrides(params),
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      searchParams.set('organizationId', params.organizationId);
      if (params.cursor) searchParams.set('cursor', params.cursor);
      if (params.limit) searchParams.set('limit', String(params.limit));

      const qs = searchParams.toString();
      return apiClient.get<EntitlementOverrideListResponse>(
        `/admin/subscriptions/entitlements/overrides?${qs}`,
      );
    },
    enabled: !!params.organizationId,
    staleTime: 60 * 1000,
  });
}

// ─── Mutations ──────────────────────────────────────────

export function useForceCancelSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ForceCancelInput }) => {
      return apiClient.post(`/admin/subscriptions/${id}/force-cancel`, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminSubscriptionKeys.all });
    },
  });
}

export function useExtendTrial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ExtendTrialInput }) => {
      return apiClient.patch(`/admin/subscriptions/${id}/trial/extend`, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminSubscriptionKeys.all });
    },
  });
}

export function useChangeBillingPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ChangeBillingPeriodInput }) => {
      return apiClient.patch(`/admin/subscriptions/${id}/billing-period`, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminSubscriptionKeys.all });
    },
  });
}

export function useExpireTrial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return apiClient.post(`/admin/subscriptions/${id}/trial/expire`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminSubscriptionKeys.all });
    },
  });
}

export function useGrantComplimentary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: GrantComplimentaryInput) => {
      return apiClient.post('/admin/subscriptions/complimentary/grant', data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminSubscriptionKeys.all });
    },
  });
}

export function useRevokeComplimentary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: RevokeComplimentaryInput }) => {
      return apiClient.post(`/admin/subscriptions/${id}/complimentary/revoke`, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminSubscriptionKeys.all });
    },
  });
}

export function useGrantEntitlementOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: GrantEntitlementOverrideInput) => {
      return apiClient.post('/admin/subscriptions/entitlements/override', data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminSubscriptionKeys.all });
    },
  });
}

export function useRevokeEntitlementOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: RevokeEntitlementOverrideInput }) => {
      return apiClient.delete(
        `/admin/subscriptions/entitlements/override/${id}`,
        data,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminSubscriptionKeys.all });
    },
  });
}

// ─── Effective Entitlements ─────────────────────────────

/**
 * The three-layer breakdown for one subscription, resolved AS a client on
 * `platform`.
 *
 * The platform is part of the query key, not just the URL: entitlements are
 * platform-dependent, so a cache keyed on the subscription alone would serve
 * the iOS answer to a web admin (or the reverse) and the switcher would appear
 * to do nothing.
 */
export function useEffectiveEntitlements(
  subscriptionId: string,
  platform: EntitlementPlatform,
) {
  return useQuery({
    queryKey: adminSubscriptionKeys.effectiveEntitlements(
      subscriptionId,
      platform,
    ),
    queryFn: async (): Promise<EffectiveEntitlementReport> => {
      const res = await apiClient.get<EffectiveEntitlementsResponse>(
        `/admin/subscriptions/${subscriptionId}/entitlements/effective?platform=${platform}`,
      );
      return res.data;
    },
    enabled: !!subscriptionId,
    staleTime: 30 * 1000,
  });
}

/** How many subscriptions store their own value for each entitlement key. */
export function useStoredEntitlementKeyCounts(planCode?: string) {
  return useQuery({
    queryKey: adminSubscriptionKeys.storedEntitlementKeyCounts(planCode),
    queryFn: async (): Promise<Record<string, StoredEntitlementKeyStats>> => {
      const qs = planCode ? `?planCode=${encodeURIComponent(planCode)}` : '';
      const res = await apiClient.get<StoredEntitlementKeyCountsResponse>(
        `/admin/subscriptions/entitlements-json/stored-key-counts${qs}`,
      );
      return res.data;
    },
    staleTime: 60 * 1000,
  });
}

export function useSetEntitlementsJson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: SetEntitlementsJsonInput;
    }) => {
      return apiClient.patch(`/admin/subscriptions/${id}/entitlements-json`, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminSubscriptionKeys.all });
    },
  });
}

export function useClearEntitlementsJsonKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, key }: { id: string; key: string }) => {
      return apiClient.delete(
        `/admin/subscriptions/${id}/entitlements-json/${encodeURIComponent(key)}`,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminSubscriptionKeys.all });
    },
  });
}

export function usePruneEntitlementsJson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      data: PruneEntitlementsJsonInput,
    ): Promise<PruneEntitlementsJsonResult> => {
      const res = await apiClient.post<PruneEntitlementsJsonResponse>(
        '/admin/subscriptions/entitlements-json/prune',
        data,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminSubscriptionKeys.all });
    },
  });
}
