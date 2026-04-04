import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import {
  useProfile,
  useUpdateProfile,
  useMyOrganizations,
  useOrganizationMembers,
  useInviteMember,
  useUpdateMemberRole,
  useRemoveMember,
  useEnrollMfa,
  useConfirmMfa,
  useDisableMfa,
  useSessions,
  useRevokeSession,
  useRevokeAllSessions,
} from './use-settings';
import { apiClient } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
  },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('use-settings hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- User Profile ----

  describe('useProfile', () => {
    it('should fetch user profile', async () => {
      const mockResponse = {
        success: true,
        data: {
          id: 'user-1',
          email: 'test@example.com',
          fullName: 'Test User',
          phone: null,
          status: 'active',
          mfaEnabled: false,
          emailVerified: true,
          createdAt: '2026-01-01T00:00:00Z',
        },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useProfile(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/users/me');
      expect(result.current.data).toEqual(mockResponse.data);
    });

    it('should handle API errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Unauthorized'));

      const { result } = renderHook(() => useProfile(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe('useUpdateProfile', () => {
    it('should call PATCH to update user profile', async () => {
      const mockResponse = {
        success: true,
        data: { id: 'user-1', fullName: 'Updated Name', phone: '+639123456789' },
      };
      vi.mocked(apiClient.patch).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useUpdateProfile(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        const data = await result.current.mutateAsync({
          fullName: 'Updated Name',
          phone: '+639123456789',
        });
        expect(data).toEqual(mockResponse.data);
      });

      expect(apiClient.patch).toHaveBeenCalledWith('/users/me', {
        fullName: 'Updated Name',
        phone: '+639123456789',
      });
    });

    it('should handle mutation errors', async () => {
      vi.mocked(apiClient.patch).mockRejectedValue(new Error('Validation error'));

      const { result } = renderHook(() => useUpdateProfile(), {
        wrapper: createWrapper(),
      });

      await expect(
        act(async () => {
          await result.current.mutateAsync({ fullName: '' });
        }),
      ).rejects.toThrow('Validation error');
    });
  });

  // ---- Organizations ----

  describe('useMyOrganizations', () => {
    it('should fetch user organizations', async () => {
      const mockResponse = {
        success: true,
        data: [{ id: 'org-1', name: 'Test Org', slug: 'test-org', type: 'law_firm' }],
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useMyOrganizations(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/organizations/me');
      expect(result.current.data).toEqual(mockResponse.data);
    });
  });

  describe('useOrganizationMembers', () => {
    it('should fetch organization members when orgId is provided', async () => {
      const mockResponse = {
        success: true,
        data: [{ id: 'member-1', userId: 'user-1', role: 'admin', status: 'active' }],
        meta: { hasNext: false, cursor: null },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useOrganizationMembers('org-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/organizations/org-1/members');
    });

    it('should be disabled when orgId is empty', () => {
      const { result } = renderHook(() => useOrganizationMembers(''), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe('idle');
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });

  describe('useInviteMember', () => {
    it('should call POST to invite a member', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ success: true });

      const { result } = renderHook(() => useInviteMember('org-1'), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({ email: 'new@example.com', role: 'member' });
      });

      expect(apiClient.post).toHaveBeenCalledWith('/organizations/org-1/members/invite', {
        email: 'new@example.com',
        role: 'member',
      });
    });
  });

  describe('useUpdateMemberRole', () => {
    it('should call PATCH to update member role', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({ success: true });

      const { result } = renderHook(() => useUpdateMemberRole('org-1'), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({ userId: 'user-2', role: 'admin' });
      });

      expect(apiClient.patch).toHaveBeenCalledWith('/organizations/org-1/members/user-2', {
        role: 'admin',
      });
    });
  });

  describe('useRemoveMember', () => {
    it('should call DELETE to remove a member', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ success: true });

      const { result } = renderHook(() => useRemoveMember('org-1'), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync('user-2');
      });

      expect(apiClient.delete).toHaveBeenCalledWith('/organizations/org-1/members/user-2');
    });
  });

  // ---- MFA ----

  describe('useEnrollMfa', () => {
    it('should call POST to enroll MFA', async () => {
      const mockResponse = {
        success: true,
        data: {
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUrl: 'otpauth://totp/Libertasian:test@example.com?secret=JBSWY3DPEHPK3PXP',
        },
      };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useEnrollMfa(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        const data = await result.current.mutateAsync();
        expect(data).toEqual(mockResponse.data);
      });

      expect(apiClient.post).toHaveBeenCalledWith('/auth/mfa/enroll');
    });
  });

  describe('useConfirmMfa', () => {
    it('should call POST to confirm MFA with code', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ success: true });

      const { result } = renderHook(() => useConfirmMfa(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync('123456');
      });

      expect(apiClient.post).toHaveBeenCalledWith('/auth/mfa/verify', { code: '123456' });
    });
  });

  describe('useDisableMfa', () => {
    it('should call POST to disable MFA with password', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ success: true });

      const { result } = renderHook(() => useDisableMfa(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync('myPassword123');
      });

      expect(apiClient.post).toHaveBeenCalledWith('/auth/mfa/disable', {
        password: 'myPassword123',
      });
    });
  });

  // ---- Sessions ----

  describe('useSessions', () => {
    it('should fetch active sessions', async () => {
      const mockResponse = {
        success: true,
        data: [
          {
            familyId: 'fam-1',
            deviceFingerprint: 'Chrome/Windows',
            createdAt: '2026-01-01T00:00:00Z',
            lastUsedAt: '2026-03-22T00:00:00Z',
          },
        ],
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useSessions(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/auth/sessions');
      expect(result.current.data).toEqual(mockResponse.data);
    });

    it('should handle API errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Unauthorized'));

      const { result } = renderHook(() => useSessions(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe('useRevokeSession', () => {
    it('should call DELETE to revoke a specific session', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ success: true });

      const { result } = renderHook(() => useRevokeSession(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync('fam-1');
      });

      expect(apiClient.delete).toHaveBeenCalledWith('/auth/sessions/fam-1');
    });
  });

  describe('useRevokeAllSessions', () => {
    it('should call DELETE to revoke all sessions', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ success: true });

      const { result } = renderHook(() => useRevokeAllSessions(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync();
      });

      expect(apiClient.delete).toHaveBeenCalledWith('/auth/sessions');
    });
  });
});
