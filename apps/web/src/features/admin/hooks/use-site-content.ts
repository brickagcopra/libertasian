'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

interface SiteContentRecord {
  key: string;
  content: Record<string, unknown>;
  version: number;
  updatedBy?: string;
  updatedAt: string;
}

export function useSiteContent(key: string) {
  return useQuery({
    queryKey: ['site-content', key],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: SiteContentRecord }>(
        `/site-content/${key}`,
      );
      return res.data;
    },
  });
}

export function useUpdateSiteContent(key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (content: Record<string, unknown>) => {
      const res = await apiClient.put<{ success: boolean; data: SiteContentRecord }>(
        `/site-content/${key}`,
        { content },
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-content', key] });
    },
  });
}

export function useDeleteSiteContent(key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiClient.delete(`/site-content/${key}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-content', key] });
    },
  });
}
