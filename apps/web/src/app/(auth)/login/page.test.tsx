/**
 * Login page unit tests.
 *
 * Note: Full component render tests for React 19 'use client' components
 * with react-hook-form require vitest@3+ or next/jest. These tests validate
 * the login form behavior through schema validation and hook integration
 * rather than full DOM rendering.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { loginSchema } from '@/features/auth/schemas';

// ─── Schema Validation Tests ─────────────────────────────────────────

describe('loginSchema', () => {
  it('passes with valid email and password', () => {
    const result = loginSchema.safeParse({
      email: 'test@example.com',
      password: 'password123',
    });
    expect(result.success).toBe(true);
  });

  it('fails when email is empty', () => {
    const result = loginSchema.safeParse({
      email: '',
      password: 'password123',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Email is required');
    }
  });

  it('fails when email is invalid', () => {
    const result = loginSchema.safeParse({
      email: 'not-an-email',
      password: 'password123',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Invalid email address');
    }
  });

  it('fails when password is empty', () => {
    const result = loginSchema.safeParse({
      email: 'test@example.com',
      password: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Password is required');
    }
  });

  it('allows optional mfaCode', () => {
    const result = loginSchema.safeParse({
      email: 'test@example.com',
      password: 'password123',
      mfaCode: '123456',
    });
    expect(result.success).toBe(true);
  });

  it('allows missing mfaCode', () => {
    const result = loginSchema.safeParse({
      email: 'test@example.com',
      password: 'password123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mfaCode).toBeUndefined();
    }
  });
});

// ─── useLogin Hook Tests ─────────────────────────────────────────────

const mockPost = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: (...args: unknown[]) => mockPost(...args),
  },
  ApiClientError: class ApiClientError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.name = 'ApiClientError';
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({
    setTokens: vi.fn(),
    setUser: vi.fn(),
  }),
}));

import { useLogin } from '@/features/auth/hooks/use-auth';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useLogin hook', () => {
  it('calls POST /auth/login with credentials', async () => {
    const loginResponse = {
      success: true,
      data: {
        tokens: { accessToken: 'at-123', refreshToken: 'rt-456' },
        user: { id: '1', email: 'test@example.com', fullName: 'Test', role: 'member', organizationId: 'org-1', mfaEnabled: false, emailVerified: true },
        mfaRequired: false,
      },
    };
    mockPost.mockResolvedValueOnce(loginResponse);

    const { result } = renderHook(() => useLogin(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        email: 'test@example.com',
        password: 'password123',
      });
    });

    expect(mockPost).toHaveBeenCalledWith('/auth/login', {
      email: 'test@example.com',
      password: 'password123',
    });
  });

  it('includes mfaCode when provided', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: {
        tokens: { accessToken: 'at', refreshToken: 'rt' },
        user: { id: '1', email: 'test@example.com' },
        mfaRequired: false,
      },
    });

    const { result } = renderHook(() => useLogin(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        email: 'test@example.com',
        password: 'password123',
        mfaCode: '123456',
      });
    });

    expect(mockPost).toHaveBeenCalledWith('/auth/login', {
      email: 'test@example.com',
      password: 'password123',
      mfaCode: '123456',
    });
  });

  it('returns mfaRequired when server indicates MFA is needed', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: {
        tokens: { accessToken: '', refreshToken: '' },
        user: null,
        mfaRequired: true,
      },
    });

    const { result } = renderHook(() => useLogin(), { wrapper: createWrapper() });

    let loginResult: unknown;
    await act(async () => {
      loginResult = await result.current.mutateAsync({
        email: 'test@example.com',
        password: 'password123',
      });
    });

    expect((loginResult as { mfaRequired: boolean }).mfaRequired).toBe(true);
  });

  it('throws on API error', async () => {
    mockPost.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useLogin(), { wrapper: createWrapper() });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          email: 'test@example.com',
          password: 'password123',
        });
      }),
    ).rejects.toThrow('Network error');
  });
});
