'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: string;
  mfaEnabled: boolean;
  emailVerified: boolean;
  createdAt: string;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  type: string;
  createdAt: string;
}

interface OrganizationMember {
  id: string;
  userId: string;
  role: string;
  status: string;
  createdAt: string;
  user?: {
    id: string;
    email: string;
    fullName: string;
  };
}

interface Session {
  familyId: string;
  deviceFingerprint: string;
  createdAt: string;
  lastUsedAt: string;
}

interface MfaEnrollResult {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl?: string;
}

// ---- User Profile ----

export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: UserProfile }>('/users/me');
      return res.data;
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { fullName?: string; phone?: string }) => {
      const res = await apiClient.patch<{ success: boolean; data: UserProfile }>('/users/me', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

// ---- Organizations ----

export function useMyOrganizations() {
  return useQuery({
    queryKey: ['my-organizations'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: Organization[] }>(
        '/organizations/me',
      );
      return res.data;
    },
  });
}

export function useOrganizationMembers(orgId: string) {
  return useQuery({
    queryKey: ['org-members', orgId],
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: OrganizationMember[];
        meta: { hasNext: boolean; cursor: string | null };
      }>(`/organizations/${orgId}/members`);
      return res;
    },
    enabled: !!orgId,
  });
}

export function useInviteMember(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { email: string; role: string }) => {
      return apiClient.post(`/organizations/${orgId}/members/invite`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', orgId] });
    },
  });
}

export function useUpdateMemberRole(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      return apiClient.patch(`/organizations/${orgId}/members/${userId}`, { role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', orgId] });
    },
  });
}

export function useRemoveMember(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      return apiClient.delete(`/organizations/${orgId}/members/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', orgId] });
    },
  });
}

// ---- MFA ----

export function useEnrollMfa() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ success: boolean; data: MfaEnrollResult }>(
        '/auth/mfa/enroll',
      );
      return res.data;
    },
  });
}

export function useConfirmMfa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      return apiClient.post('/auth/mfa/verify', { code });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useDisableMfa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (password: string) => {
      return apiClient.post('/auth/mfa/disable', { password });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

// ---- Password ----

export function useChangePassword() {
  return useMutation({
    mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
      return apiClient.post('/auth/change-password', data);
    },
  });
}

// ---- Sessions ----

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: Session[] }>('/auth/sessions');
      return res.data;
    },
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (familyId: string) => {
      return apiClient.delete(`/auth/sessions/${familyId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useRevokeAllSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      return apiClient.delete('/auth/sessions');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}
