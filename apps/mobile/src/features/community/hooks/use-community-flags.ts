import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  CreateFlagInput,
  ExpertVerificationResponse,
  MyExpertVerificationResponse,
  SubmitExpertVerificationInput,
} from '../types';

// ─── Flag Reporting ─────────────────────────────────────────────────────

export function useCreateFlag() {
  return useMutation({
    mutationFn: (data: CreateFlagInput) =>
      apiClient.post<{ id: string }>('/community/flags', data),
  });
}

// ─── Expert Verification ────────────────────────────────────────────────

export function useMyExpertVerification() {
  return useQuery({
    queryKey: ['my-expert-verification'],
    queryFn: () =>
      apiClient.get<MyExpertVerificationResponse>(
        '/community/expert-verification/me',
      ),
  });
}

export function useSubmitExpertVerification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: SubmitExpertVerificationInput) =>
      apiClient.post<ExpertVerificationResponse>(
        '/community/expert-verification',
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-expert-verification'] });
    },
  });
}
