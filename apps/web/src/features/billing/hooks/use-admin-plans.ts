'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import { planKeys } from './use-plans';
import type {
  AdminPlanDetail,
  AdminPlanListResponse,
  AdminPlanResponse,
  CreatePlanInput,
  UpdatePlanInput,
  CreatePlanPriceInput,
  UpdatePlanPriceInput,
  CreatePlanEntitlementInput,
  UpdatePlanEntitlementInput,
  PlanPriceDetail,
  PlanPriceResponse,
  PlanEntitlementDetail,
  PlanEntitlementResponse,
  PlanComparisonResult,
  PlanComparisonResponse,
} from '../types';

// ─── Query Keys ──────────────────────────────────────────

export const adminPlanKeys = {
  all: ['admin', 'plans'] as const,
  list: () => [...adminPlanKeys.all, 'list'] as const,
  detail: (id: string) => [...adminPlanKeys.all, 'detail', id] as const,
  compare: (fromCode: string, toCode: string) =>
    [...adminPlanKeys.all, 'compare', fromCode, toCode] as const,
};

// ─── Queries ─────────────────────────────────────────────

/** Fetch all plans (admin view — includes archived / inactive) */
export function useAdminPlans() {
  return useQuery({
    queryKey: adminPlanKeys.list(),
    queryFn: async (): Promise<AdminPlanDetail[]> => {
      const res = await apiClient.get<AdminPlanListResponse>('/admin/plans');
      return res.data;
    },
    staleTime: 2 * 60 * 1000,
  });
}

/** Fetch a single plan by ID (admin view) */
export function useAdminPlan(id: string) {
  return useQuery({
    queryKey: adminPlanKeys.detail(id),
    queryFn: async (): Promise<AdminPlanDetail> => {
      const res = await apiClient.get<AdminPlanResponse>(`/admin/plans/${id}`);
      return res.data;
    },
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

/** Compare entitlements between two plans */
export function useComparePlans(fromCode: string, toCode: string) {
  return useQuery({
    queryKey: adminPlanKeys.compare(fromCode, toCode),
    queryFn: async (): Promise<PlanComparisonResult> => {
      const res = await apiClient.get<PlanComparisonResponse>(
        `/admin/plans/compare/${fromCode}/${toCode}`,
      );
      return res.data;
    },
    enabled: !!fromCode && !!toCode && fromCode !== toCode,
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Plan CRUD Mutations ─────────────────────────────────

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePlanInput): Promise<AdminPlanDetail> => {
      const res = await apiClient.post<AdminPlanResponse>(
        '/admin/plans',
        input,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminPlanKeys.all });
      qc.invalidateQueries({ queryKey: planKeys.all });
    },
  });
}

export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdatePlanInput;
    }): Promise<AdminPlanDetail> => {
      const res = await apiClient.patch<AdminPlanResponse>(
        `/admin/plans/${id}`,
        data,
      );
      return res.data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: adminPlanKeys.detail(variables.id) });
      qc.invalidateQueries({ queryKey: adminPlanKeys.list() });
      qc.invalidateQueries({ queryKey: planKeys.all });
    },
  });
}

export function useArchivePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<AdminPlanDetail> => {
      const res = await apiClient.post<AdminPlanResponse>(
        `/admin/plans/${id}/archive`,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminPlanKeys.all });
      qc.invalidateQueries({ queryKey: planKeys.all });
    },
  });
}

// ─── Price Mutations ─────────────────────────────────────

export function useCreatePlanPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      planId,
      data,
    }: {
      planId: string;
      data: CreatePlanPriceInput;
    }): Promise<PlanPriceDetail> => {
      const res = await apiClient.post<PlanPriceResponse>(
        `/admin/plans/${planId}/prices`,
        data,
      );
      return res.data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: adminPlanKeys.detail(variables.planId),
      });
      qc.invalidateQueries({ queryKey: adminPlanKeys.list() });
      qc.invalidateQueries({ queryKey: planKeys.all });
    },
  });
}

export function useUpdatePlanPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      planId,
      priceId,
      data,
    }: {
      planId: string;
      priceId: string;
      data: UpdatePlanPriceInput;
    }): Promise<PlanPriceDetail> => {
      const res = await apiClient.patch<PlanPriceResponse>(
        `/admin/plans/${planId}/prices/${priceId}`,
        data,
      );
      return res.data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: adminPlanKeys.detail(variables.planId),
      });
      qc.invalidateQueries({ queryKey: adminPlanKeys.list() });
      qc.invalidateQueries({ queryKey: planKeys.all });
    },
  });
}

export function useDeactivatePlanPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      planId,
      priceId,
    }: {
      planId: string;
      priceId: string;
    }): Promise<PlanPriceDetail> => {
      const res = await apiClient.delete<PlanPriceResponse>(
        `/admin/plans/${planId}/prices/${priceId}`,
      );
      return res.data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: adminPlanKeys.detail(variables.planId),
      });
      qc.invalidateQueries({ queryKey: adminPlanKeys.list() });
      qc.invalidateQueries({ queryKey: planKeys.all });
    },
  });
}

// ─── Entitlement Mutations ───────────────────────────────

export function useCreatePlanEntitlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      planId,
      data,
    }: {
      planId: string;
      data: CreatePlanEntitlementInput;
    }): Promise<PlanEntitlementDetail> => {
      const res = await apiClient.post<PlanEntitlementResponse>(
        `/admin/plans/${planId}/entitlements`,
        data,
      );
      return res.data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: adminPlanKeys.detail(variables.planId),
      });
      qc.invalidateQueries({ queryKey: adminPlanKeys.list() });
      qc.invalidateQueries({ queryKey: planKeys.all });
    },
  });
}

export function useUpdatePlanEntitlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      planId,
      entitlementId,
      data,
    }: {
      planId: string;
      entitlementId: string;
      data: UpdatePlanEntitlementInput;
    }): Promise<PlanEntitlementDetail> => {
      const res = await apiClient.patch<PlanEntitlementResponse>(
        `/admin/plans/${planId}/entitlements/${entitlementId}`,
        data,
      );
      return res.data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: adminPlanKeys.detail(variables.planId),
      });
      qc.invalidateQueries({ queryKey: adminPlanKeys.list() });
      qc.invalidateQueries({ queryKey: planKeys.all });
    },
  });
}

export function useDeletePlanEntitlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      planId,
      entitlementId,
    }: {
      planId: string;
      entitlementId: string;
    }): Promise<void> => {
      await apiClient.delete(
        `/admin/plans/${planId}/entitlements/${entitlementId}`,
      );
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: adminPlanKeys.detail(variables.planId),
      });
      qc.invalidateQueries({ queryKey: adminPlanKeys.list() });
      qc.invalidateQueries({ queryKey: planKeys.all });
    },
  });
}
