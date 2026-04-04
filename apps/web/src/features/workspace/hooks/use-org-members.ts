'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

interface OrgMember {
  id: string;
  userId: string;
  role: string;
  status: string;
  user: {
    id: string;
    fullName: string;
    email: string;
  };
}

interface OrgMembersResponse {
  success: boolean;
  data: OrgMember[];
}

export function useOrgMembers(orgId: string | null) {
  return useQuery({
    queryKey: ['org-members', orgId],
    queryFn: async () => {
      const res = await apiClient.get<OrgMembersResponse>(`/organizations/${orgId}/members`);
      return res.data;
    },
    enabled: !!orgId,
  });
}
