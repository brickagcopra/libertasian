'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  AdminCouponDetail,
  AdminCouponListResponse,
  AdminCouponResponse,
  CreateCouponInput,
  UpdateCouponInput,
  ListCouponsQuery,
  ListRedemptionsQuery,
  CouponRedemptionDetail,
  CouponRedemptionListResponse,
  SetCouponPlanRuleInput,
  CouponPlanRule,
} from '../types';

// ─── Query Keys ──────────────────────────────────────────

export const adminCouponKeys = {
  all: ['admin', 'coupons'] as const,
  list: (params?: ListCouponsQuery) =>
    [...adminCouponKeys.all, 'list', params ?? {}] as const,
  detail: (id: string) => [...adminCouponKeys.all, 'detail', id] as const,
  redemptions: (id: string, params?: ListRedemptionsQuery) =>
    [...adminCouponKeys.all, 'redemptions', id, params ?? {}] as const,
};

// ─── Queries ─────────────────────────────────────────────

/** Fetch all coupons (admin view — includes archived) */
export function useAdminCoupons(params?: ListCouponsQuery) {
  return useQuery({
    queryKey: adminCouponKeys.list(params),
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.cursor) searchParams.set('cursor', params.cursor);
      if (params?.limit) searchParams.set('limit', String(params.limit));
      if (params?.search) searchParams.set('search', params.search);
      if (params?.discountType) searchParams.set('discountType', params.discountType);
      if (params?.isActive !== undefined) searchParams.set('isActive', String(params.isActive));
      if (params?.isArchived !== undefined) searchParams.set('isArchived', String(params.isArchived));
      if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
      if (params?.sortDir) searchParams.set('sortDir', params.sortDir);

      const qs = searchParams.toString();
      const url = `/admin/coupons${qs ? `?${qs}` : ''}`;
      const res = await apiClient.get<AdminCouponListResponse>(url);
      return res;
    },
    staleTime: 2 * 60 * 1000,
  });
}

/** Fetch a single coupon by ID */
export function useAdminCoupon(id: string) {
  return useQuery({
    queryKey: adminCouponKeys.detail(id),
    queryFn: async (): Promise<AdminCouponDetail> => {
      const res = await apiClient.get<AdminCouponResponse>(
        `/admin/coupons/${id}`,
      );
      return res.data;
    },
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

/** Fetch redemption history for a coupon */
export function useCouponRedemptions(
  couponId: string,
  params?: ListRedemptionsQuery,
) {
  return useQuery({
    queryKey: adminCouponKeys.redemptions(couponId, params),
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.cursor) searchParams.set('cursor', params.cursor);
      if (params?.limit) searchParams.set('limit', String(params.limit));
      if (params?.status) searchParams.set('status', params.status);
      if (params?.organizationId)
        searchParams.set('organizationId', params.organizationId);

      const qs = searchParams.toString();
      const url = `/admin/coupons/${couponId}/redemptions${qs ? `?${qs}` : ''}`;
      const res = await apiClient.get<CouponRedemptionListResponse>(url);
      return res;
    },
    enabled: !!couponId,
    staleTime: 60 * 1000,
  });
}

// ─── Coupon CRUD Mutations ───────────────────────────────

export function useCreateCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCouponInput): Promise<AdminCouponDetail> => {
      const res = await apiClient.post<AdminCouponResponse>(
        '/admin/coupons',
        input,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminCouponKeys.all });
    },
  });
}

export function useUpdateCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateCouponInput;
    }): Promise<AdminCouponDetail> => {
      const res = await apiClient.patch<AdminCouponResponse>(
        `/admin/coupons/${id}`,
        data,
      );
      return res.data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: adminCouponKeys.detail(variables.id) });
      qc.invalidateQueries({ queryKey: adminCouponKeys.all });
    },
  });
}

export function useArchiveCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<AdminCouponDetail> => {
      const res = await apiClient.post<AdminCouponResponse>(
        `/admin/coupons/${id}/archive`,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminCouponKeys.all });
    },
  });
}

export function useActivateCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<AdminCouponDetail> => {
      const res = await apiClient.post<AdminCouponResponse>(
        `/admin/coupons/${id}/activate`,
      );
      return res.data;
    },
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: adminCouponKeys.detail(id) });
      qc.invalidateQueries({ queryKey: adminCouponKeys.all });
    },
  });
}

export function useDeactivateCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<AdminCouponDetail> => {
      const res = await apiClient.post<AdminCouponResponse>(
        `/admin/coupons/${id}/deactivate`,
      );
      return res.data;
    },
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: adminCouponKeys.detail(id) });
      qc.invalidateQueries({ queryKey: adminCouponKeys.all });
    },
  });
}

// ─── Assignment Mutations ────────────────────────────────

export function useAssignCouponUsers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      couponId,
      userIds,
    }: {
      couponId: string;
      userIds: string[];
    }) => {
      const res = await apiClient.post(
        `/admin/coupons/${couponId}/assign-users`,
        { userIds },
      );
      return res;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: adminCouponKeys.detail(variables.couponId),
      });
    },
  });
}

export function useAssignCouponOrgs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      couponId,
      organizationIds,
    }: {
      couponId: string;
      organizationIds: string[];
    }) => {
      const res = await apiClient.post(
        `/admin/coupons/${couponId}/assign-orgs`,
        { organizationIds },
      );
      return res;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: adminCouponKeys.detail(variables.couponId),
      });
    },
  });
}

// ─── Plan Rules Mutation ─────────────────────────────────

export function useSetCouponPlanRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      couponId,
      rules,
    }: {
      couponId: string;
      rules: SetCouponPlanRuleInput[];
    }) => {
      const res = await apiClient.post(
        `/admin/coupons/${couponId}/plan-rules`,
        { rules },
      );
      return res;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: adminCouponKeys.detail(variables.couponId),
      });
      qc.invalidateQueries({ queryKey: adminCouponKeys.all });
    },
  });
}
