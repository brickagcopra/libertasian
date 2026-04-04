'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  AdminPromotionDetail,
  AdminPromotionListResponse,
  AdminPromotionResponse,
  CreatePromotionInput,
  UpdatePromotionInput,
  ListPromotionsQuery,
  ListPromotionRedemptionsQuery,
  PromotionRedemptionListResponse,
  PromotionRuleDetail,
  AdminPromotionBenefitDetail,
  PromotionPlanRuleDetail,
  CreatePromotionRuleInput,
  CreatePromotionBenefitInput,
  SetPromotionPlanRuleInput,
} from '../types';

// ─── Query Keys ──────────────────────────────────────────

export const adminPromotionKeys = {
  all: ['admin', 'promotions'] as const,
  list: (params?: ListPromotionsQuery) =>
    [...adminPromotionKeys.all, 'list', params ?? {}] as const,
  detail: (id: string) => [...adminPromotionKeys.all, 'detail', id] as const,
  redemptions: (id: string, params?: ListPromotionRedemptionsQuery) =>
    [...adminPromotionKeys.all, 'redemptions', id, params ?? {}] as const,
};

// ─── Queries ─────────────────────────────────────────────

/** Fetch all promotions (admin view — includes archived) */
export function useAdminPromotions(params?: ListPromotionsQuery) {
  return useQuery({
    queryKey: adminPromotionKeys.list(params),
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.cursor) searchParams.set('cursor', params.cursor);
      if (params?.limit) searchParams.set('limit', String(params.limit));
      if (params?.search) searchParams.set('search', params.search);
      if (params?.status) searchParams.set('status', params.status);
      if (params?.promotionType) searchParams.set('promotionType', params.promotionType);
      if (params?.isDisplayedOnPricing !== undefined)
        searchParams.set('isDisplayedOnPricing', String(params.isDisplayedOnPricing));
      if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
      if (params?.sortDir) searchParams.set('sortDir', params.sortDir);

      const qs = searchParams.toString();
      const url = `/admin/promotions${qs ? `?${qs}` : ''}`;
      const res = await apiClient.get<AdminPromotionListResponse>(url);
      return res;
    },
    staleTime: 2 * 60 * 1000,
  });
}

/** Fetch a single promotion by ID (includes stats) */
export function useAdminPromotion(id: string) {
  return useQuery({
    queryKey: adminPromotionKeys.detail(id),
    queryFn: async (): Promise<AdminPromotionDetail> => {
      const res = await apiClient.get<AdminPromotionResponse>(
        `/admin/promotions/${id}`,
      );
      return res.data;
    },
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

/** Fetch redemption history for a promotion */
export function usePromotionRedemptions(
  promotionId: string,
  params?: ListPromotionRedemptionsQuery,
) {
  return useQuery({
    queryKey: adminPromotionKeys.redemptions(promotionId, params),
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.cursor) searchParams.set('cursor', params.cursor);
      if (params?.limit) searchParams.set('limit', String(params.limit));
      if (params?.status) searchParams.set('status', params.status);
      if (params?.organizationId)
        searchParams.set('organizationId', params.organizationId);

      const qs = searchParams.toString();
      const url = `/admin/promotions/${promotionId}/redemptions${qs ? `?${qs}` : ''}`;
      const res = await apiClient.get<PromotionRedemptionListResponse>(url);
      return res;
    },
    enabled: !!promotionId,
    staleTime: 60 * 1000,
  });
}

// ─── Promotion CRUD Mutations ───────────────────────────

export function useCreatePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePromotionInput): Promise<AdminPromotionDetail> => {
      const res = await apiClient.post<AdminPromotionResponse>(
        '/admin/promotions',
        input,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminPromotionKeys.all });
    },
  });
}

export function useUpdatePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdatePromotionInput;
    }): Promise<AdminPromotionDetail> => {
      const res = await apiClient.patch<AdminPromotionResponse>(
        `/admin/promotions/${id}`,
        data,
      );
      return res.data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: adminPromotionKeys.detail(variables.id) });
      qc.invalidateQueries({ queryKey: adminPromotionKeys.all });
    },
  });
}

export function useArchivePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<AdminPromotionDetail> => {
      const res = await apiClient.post<AdminPromotionResponse>(
        `/admin/promotions/${id}/archive`,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminPromotionKeys.all });
    },
  });
}

export function useActivatePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<AdminPromotionDetail> => {
      const res = await apiClient.post<AdminPromotionResponse>(
        `/admin/promotions/${id}/activate`,
      );
      return res.data;
    },
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: adminPromotionKeys.detail(id) });
      qc.invalidateQueries({ queryKey: adminPromotionKeys.all });
    },
  });
}

export function usePausePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<AdminPromotionDetail> => {
      const res = await apiClient.post<AdminPromotionResponse>(
        `/admin/promotions/${id}/pause`,
      );
      return res.data;
    },
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: adminPromotionKeys.detail(id) });
      qc.invalidateQueries({ queryKey: adminPromotionKeys.all });
    },
  });
}

// ─── Redemption Mutations ───────────────────────────────

export function useRevokePromotionRedemption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      redemptionId,
      reason,
    }: {
      redemptionId: string;
      reason: string;
    }) => {
      const res = await apiClient.post(
        `/admin/promotions/redemptions/${redemptionId}/revoke`,
        { reason },
      );
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminPromotionKeys.all });
    },
  });
}

// ─── Rules / Benefits / Plan Rules Mutations ────────────

export function useSetPromotionRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      promotionId,
      rules,
    }: {
      promotionId: string;
      rules: CreatePromotionRuleInput[];
    }) => {
      const res = await apiClient.post<{ success: boolean; data: PromotionRuleDetail[] }>(
        `/admin/promotions/${promotionId}/rules`,
        { rules },
      );
      return res;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: adminPromotionKeys.detail(variables.promotionId),
      });
      qc.invalidateQueries({ queryKey: adminPromotionKeys.all });
    },
  });
}

export function useSetPromotionBenefits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      promotionId,
      benefits,
    }: {
      promotionId: string;
      benefits: CreatePromotionBenefitInput[];
    }) => {
      const res = await apiClient.post<{ success: boolean; data: AdminPromotionBenefitDetail[] }>(
        `/admin/promotions/${promotionId}/benefits`,
        { benefits },
      );
      return res;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: adminPromotionKeys.detail(variables.promotionId),
      });
      qc.invalidateQueries({ queryKey: adminPromotionKeys.all });
    },
  });
}

export function useSetPromotionPlanRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      promotionId,
      rules,
    }: {
      promotionId: string;
      rules: SetPromotionPlanRuleInput[];
    }) => {
      const res = await apiClient.post<{ success: boolean; data: PromotionPlanRuleDetail[] }>(
        `/admin/promotions/${promotionId}/plan-rules`,
        { rules },
      );
      return res;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: adminPromotionKeys.detail(variables.promotionId),
      });
      qc.invalidateQueries({ queryKey: adminPromotionKeys.all });
    },
  });
}
