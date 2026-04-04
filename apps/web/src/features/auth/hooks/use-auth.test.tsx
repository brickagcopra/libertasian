import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: vi.fn(),
  },
  ApiClientError: class ApiClientError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

const mockSetTokens = vi.fn();
const mockSetUser = vi.fn();
const mockLogout = vi.fn();
const mockRefreshToken = 'mock-refresh-token';

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn(() => ({
    setTokens: mockSetTokens,
    setUser: mockSetUser,
    logout: mockLogout,
    refreshToken: mockRefreshToken,
  })),
}));

vi.mock('@/lib/constants', () => ({
  ROUTES: { LOGIN: '/login' },
}));

import { apiClient, ApiClientError } from '@/lib/api-client';
import {
  useLogin,
  useRegister,
  useLogout,
  useForgotPassword,
  useResetPassword,
  useVerifyEmail,
  useRefreshToken,
} from './use-auth';

const mockPost = vi.mocked(apiClient.post);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('useLogin', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockSetTokens.mockReset();
    mockSetUser.mockReset();
  });

  it('calls POST /auth/login with email and password', async () => {
    const mockUser = { id: 'u1', email: 'test@example.com', fullName: 'Test' };
    mockPost.mockResolvedValueOnce({
      success: true,
      data: {
        tokens: { accessToken: 'at', refreshToken: 'rt' },
        user: mockUser,
        mfaRequired: false,
      },
    });

    const { result } = renderHook(() => useLogin(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ email: 'test@example.com', password: 'pass123' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/auth/login', {
      email: 'test@example.com',
      password: 'pass123',
    });
    expect(mockSetTokens).toHaveBeenCalledWith('at', 'rt');
    expect(mockSetUser).toHaveBeenCalledWith(mockUser);
  });

  it('does not set tokens when mfaRequired is true', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: {
        tokens: { accessToken: 'at', refreshToken: 'rt' },
        user: { id: 'u1' },
        mfaRequired: true,
      },
    });

    const { result } = renderHook(() => useLogin(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ email: 'test@example.com', password: 'pass123' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockSetTokens).not.toHaveBeenCalled();
  });

  it('handles login error', async () => {
    mockPost.mockRejectedValueOnce(new Error('Invalid credentials'));

    const { result } = renderHook(() => useLogin(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ email: 'test@example.com', password: 'wrong' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useRegister', () => {
  beforeEach(() => mockPost.mockReset());

  it('calls POST /auth/register', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: { user: { id: 'u1', email: 'new@example.com' } },
    });

    const { result } = renderHook(() => useRegister(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        email: 'new@example.com',
        password: 'securePass1',
        fullName: 'New User',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/auth/register', {
      email: 'new@example.com',
      password: 'securePass1',
      fullName: 'New User',
    });
  });
});

describe('useLogout', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockLogout.mockReset();
  });

  it('calls POST /auth/logout and clears state', async () => {
    mockPost.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useLogout(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/auth/logout', {
      refreshToken: mockRefreshToken,
    });
    expect(mockLogout).toHaveBeenCalled();
  });
});

describe('useForgotPassword', () => {
  beforeEach(() => mockPost.mockReset());

  it('calls POST /auth/forgot-password', async () => {
    mockPost.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useForgotPassword(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ email: 'test@example.com' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/auth/forgot-password', {
      email: 'test@example.com',
    });
  });
});

describe('useResetPassword', () => {
  beforeEach(() => mockPost.mockReset());

  it('calls POST /auth/reset-password', async () => {
    mockPost.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useResetPassword(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ token: 'reset-tok', newPassword: 'newPass1' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/auth/reset-password', {
      token: 'reset-tok',
      newPassword: 'newPass1',
    });
  });
});

describe('useVerifyEmail', () => {
  beforeEach(() => mockPost.mockReset());

  it('calls POST /auth/verify-email', async () => {
    mockPost.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useVerifyEmail(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ token: 'verify-tok' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/auth/verify-email', {
      token: 'verify-tok',
    });
  });
});

describe('useRefreshToken', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockSetTokens.mockReset();
    mockSetUser.mockReset();
    mockLogout.mockReset();
  });

  it('refreshes tokens successfully', async () => {
    const mockUser = { id: 'u1', email: 'test@example.com' };
    mockPost.mockResolvedValueOnce({
      success: true,
      data: {
        tokens: { accessToken: 'new-at', refreshToken: 'new-rt' },
        user: mockUser,
      },
    });

    const { result } = renderHook(() => useRefreshToken(), {
      wrapper: createWrapper(),
    });

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current();
    });

    expect(success).toBe(true);
    expect(mockPost).toHaveBeenCalledWith('/auth/refresh', {
      refreshToken: mockRefreshToken,
    });
    expect(mockSetTokens).toHaveBeenCalledWith('new-at', 'new-rt');
    expect(mockSetUser).toHaveBeenCalledWith(mockUser);
  });

  it('calls logout on 401 error', async () => {
    mockPost.mockRejectedValueOnce(new ApiClientError('Unauthorized', 401));

    const { result } = renderHook(() => useRefreshToken(), {
      wrapper: createWrapper(),
    });

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current();
    });

    expect(success).toBe(false);
    expect(mockLogout).toHaveBeenCalled();
  });
});
