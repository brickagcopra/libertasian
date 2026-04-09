'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  AdCampaign,
  AdCreative,
  CampaignAnalytics,
  CreateCampaignInput,
  UpdateCampaignInput,
  CreateCreativeInput,
  UpdateCreativeInput,
  RecordAdEventInput,
} from '../types';

// ─── Query Keys ──────────────────────────────────

export const adsKeys = {
  all: ['ads'] as const,
  active: (page: string) => [...adsKeys.all, 'active', page] as const,
  admin: () => [...adsKeys.all, 'admin'] as const,
  campaigns: (filters?: Record<string, unknown>) => [...adsKeys.admin(), 'campaigns', filters] as const,
  campaign: (id: string) => [...adsKeys.admin(), 'campaign', id] as const,
  analytics: (id: string) => [...adsKeys.admin(), 'analytics', id] as const,
};

// ─── Public Queries ──────────────────────────────

export function useActiveAds(page: string) {
  return useQuery({
    queryKey: adsKeys.active(page),
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: AdCampaign[];
      }>(`/ads/active?page=${encodeURIComponent(page)}`);
      return res.data;
    },
    staleTime: 60 * 1000, // 1 minute
    enabled: !!page,
  });
}

export function useRecordAdEvent() {
  return useMutation({
    mutationFn: async (input: RecordAdEventInput) => {
      await apiClient.post('/ads/events', input);
    },
  });
}

// ─── Admin Queries ───────────────────────────────

export function useAdminCampaigns(status?: string, cursor?: string) {
  return useQuery({
    queryKey: adsKeys.campaigns({ status, cursor }),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (cursor) params.set('cursor', cursor);
      const res = await apiClient.get<{
        success: boolean;
        data: AdCampaign[];
        meta: { hasNext: boolean; nextCursor?: string };
      }>(`/admin/ads/campaigns?${params.toString()}`);
      return res;
    },
  });
}

export function useAdminCampaign(id: string) {
  return useQuery({
    queryKey: adsKeys.campaign(id),
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: AdCampaign;
      }>(`/admin/ads/campaigns/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCampaignAnalytics(id: string) {
  return useQuery({
    queryKey: adsKeys.analytics(id),
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: CampaignAnalytics;
      }>(`/admin/ads/campaigns/${id}/analytics`);
      return res.data;
    },
    enabled: !!id,
  });
}

// ─── Admin Mutations ─────────────────────────────

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCampaignInput) => {
      const res = await apiClient.post<{ success: boolean; data: AdCampaign }>(
        '/admin/ads/campaigns',
        input,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adsKeys.campaigns() });
    },
  });
}

export function useUpdateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateCampaignInput & { id: string }) => {
      const res = await apiClient.put<{ success: boolean; data: AdCampaign }>(
        `/admin/ads/campaigns/${id}`,
        data,
      );
      return res.data;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: adsKeys.campaign(id) });
      qc.invalidateQueries({ queryKey: adsKeys.campaigns() });
    },
  });
}

export function useDeleteCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/admin/ads/campaigns/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adsKeys.campaigns() });
    },
  });
}

export function useUpdateCampaignStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiClient.put<{ success: boolean; data: AdCampaign }>(
        `/admin/ads/campaigns/${id}/status`,
        { status },
      );
      return res.data;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: adsKeys.campaign(id) });
      qc.invalidateQueries({ queryKey: adsKeys.campaigns() });
    },
  });
}

export function useCreateCreative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ campaignId, ...data }: CreateCreativeInput & { campaignId: string }) => {
      const res = await apiClient.post<{ success: boolean; data: AdCreative }>(
        `/admin/ads/campaigns/${campaignId}/creatives`,
        data,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adsKeys.admin() });
    },
  });
}

export function useUpdateCreative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateCreativeInput & { id: string }) => {
      const res = await apiClient.put<{ success: boolean; data: AdCreative }>(
        `/admin/ads/creatives/${id}`,
        data,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adsKeys.admin() });
    },
  });
}

export function useDeleteCreative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/admin/ads/creatives/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adsKeys.admin() });
    },
  });
}

export function useUploadAdImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ creativeId, file }: { creativeId: string; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiClient.post<{ success: boolean; data: { imageUrl: string } }>(
        `/admin/ads/creatives/${creativeId}/upload-image`,
        formData,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adsKeys.admin() });
    },
  });
}
