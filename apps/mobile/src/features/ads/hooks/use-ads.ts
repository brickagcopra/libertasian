import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { AdCampaign, RecordAdEventInput } from '../types';

interface ActiveAdsResponse {
  success: boolean;
  data: AdCampaign[];
}

export const adsKeys = {
  active: (page: string, userType?: string) =>
    ['ads', 'active', page, userType ?? ''] as const,
};

export function useActiveAds(page: string, userType?: string) {
  return useQuery({
    queryKey: adsKeys.active(page, userType),
    queryFn: () => {
      const params: Record<string, string> = { page };
      if (userType) params['userType'] = userType;
      return apiClient.get<ActiveAdsResponse>('/ads/active', {
        params,
        skipAuth: true,
      });
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useRecordAdEvent() {
  return useMutation({
    mutationFn: (input: RecordAdEventInput) =>
      apiClient.post('/ads/events', input, { skipAuth: true }),
  });
}
