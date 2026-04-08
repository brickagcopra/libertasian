'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export interface EmailPreferences {
  transactional: boolean;
  subscriptionUpdates: boolean;
  announcements: boolean;
  blogNotifications: boolean;
}

export function useEmailPreferences() {
  return useQuery({
    queryKey: ['email-preferences'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: EmailPreferences }>(
        '/users/me/email-preferences',
      );
      return res.data;
    },
  });
}

export function useUpdateEmailPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<Omit<EmailPreferences, 'transactional'>>) => {
      const res = await apiClient.patch<{ success: boolean; data: EmailPreferences }>(
        '/users/me/email-preferences',
        data,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-preferences'] });
    },
  });
}
