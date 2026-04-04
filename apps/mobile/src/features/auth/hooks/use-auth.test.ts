import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import {
  useLogin, useRegister, useLogout, useProfile,
  useForgotPassword, useResetPassword, useUpdateProfile,
} from './use-auth';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockPatch = (apiClient as Record<string, unknown>).patch as jest.MockedFunction<typeof apiClient.get>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useLogin', () => {
  it('posts login credentials', async () => {
    mockPost.mockResolvedValueOnce({ accessToken: 'at', refreshToken: 'rt' });
    const { result } = renderHook(() => useLogin(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ email: 'a@b.com', password: 'pass' } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/auth/login', { email: 'a@b.com', password: 'pass' }, { skipAuth: true });
  });
});

describe('useRegister', () => {
  it('posts registration data', async () => {
    mockPost.mockResolvedValueOnce({ accessToken: 'at', refreshToken: 'rt' });
    const { result } = renderHook(() => useRegister(), { wrapper: createWrapper() });
    await act(async () => {
      result.current.mutate({ email: 'a@b.com', password: 'pass', fullName: 'Test' } as never);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/auth/register', expect.anything(), { skipAuth: true });
  });
});

describe('useLogout', () => {
  it('posts logout with refresh token', async () => {
    mockPost.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useLogout(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('refresh-token-1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/auth/logout', { refreshToken: 'refresh-token-1' });
  });
});

describe('useProfile', () => {
  it('fetches user profile', async () => {
    mockGet.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com', fullName: 'Test' });
    const { result } = renderHook(() => useProfile(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/users/me');
  });

  it('is disabled when enabled is false', () => {
    const { result } = renderHook(() => useProfile(false), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useForgotPassword', () => {
  it('posts email', async () => {
    mockPost.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useForgotPassword(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ email: 'a@b.com' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/auth/forgot-password', { email: 'a@b.com' }, { skipAuth: true });
  });
});

describe('useResetPassword', () => {
  it('posts token and new password', async () => {
    mockPost.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useResetPassword(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ token: 'tok1', newPassword: 'newpass123' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/auth/reset-password', { token: 'tok1', newPassword: 'newpass123' }, { skipAuth: true });
  });
});

describe('useUpdateProfile', () => {
  it('patches profile', async () => {
    mockPatch.mockResolvedValueOnce({ id: 'u1', fullName: 'Updated' });
    const { result } = renderHook(() => useUpdateProfile(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ fullName: 'Updated' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPatch).toHaveBeenCalledWith('/users/me', { fullName: 'Updated' });
  });
});
