import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../../lib/api-client';

/** A moderation decision against the signed-in user (GET /community/standing/decisions). */
export interface StandingDecision {
  id: string;
  action: 'remove' | 'suspend' | 'ban';
  targetType: string;
  targetId: string;
  reason: string | null;
  /** Content preview for removals. */
  preview: string | null;
  /** Suspensions: when it ends. */
  endsAt: string | null;
  /** Content still removed / sanction still running. */
  inEffect: boolean;
  createdAt: string;
  appealDeadline: string;
  canAppeal: boolean;
  appeal: {
    id: string;
    status: 'open' | 'granted' | 'denied';
    statement: string;
    decisionNote: string | null;
    createdAt: string;
    decidedAt: string | null;
  } | null;
}

export const APPEAL_MIN_CHARS = 10;
export const APPEAL_MAX_CHARS = 2000;

const KEY = ['community', 'standing'] as const;

export function useCommunityStanding() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => apiClient.get<StandingDecision[]>('/community/standing/decisions'),
  });
}

export function useFileAppeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ decisionId, statement }: { decisionId: string; statement: string }) =>
      apiClient.post<StandingDecision>(
        `/community/standing/decisions/${encodeURIComponent(decisionId)}/appeal`,
        { statement },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
