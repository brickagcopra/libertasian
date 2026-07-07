import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  ApiClientError: class ApiClientError extends Error {
    statusCode: number;
    serverMessage: string;
    constructor(statusCode: number, message: string) {
      super(message);
      this.name = 'ApiClientError';
      this.statusCode = statusCode;
      this.serverMessage = message;
    }
  },
}));

import { apiClient, ApiClientError } from '../../../lib/api-client';
import {
  useChangePassword,
  useEnrollMfa,
  useConfirmMfa,
  useDisableMfa,
} from './use-security';

const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

beforeEach(() => jest.clearAllMocks());

describe('useChangePassword', () => {
  it('posts credentials with the sign-out-on-401 suppression flag', async () => {
    mockPost.mockResolvedValueOnce({ message: 'Password changed' });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useChangePassword(), { wrapper });

    await act(async () => {
      result.current.mutate({ currentPassword: 'old-password-1', newPassword: 'new-password-1' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith(
      '/auth/change-password',
      { currentPassword: 'old-password-1', newPassword: 'new-password-1' },
      { skipSignOutOn401: true },
    );
  });

  it('surfaces a 401 (wrong current password) as a mutation error with statusCode 401', async () => {
    mockPost.mockRejectedValueOnce(new ApiClientError(401, 'Unauthorized'));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useChangePassword(), { wrapper });

    await act(async () => {
      result.current.mutate({ currentPassword: 'wrong-password', newPassword: 'new-password-1' });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    const error = result.current.error as InstanceType<typeof ApiClientError>;
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.statusCode).toBe(401);
  });
});

describe('useEnrollMfa', () => {
  it('posts to /auth/mfa/enroll and returns the secret + otpauth URL', async () => {
    mockPost.mockResolvedValueOnce({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUrl: 'otpauth://totp/Libertasian:test@example.com?secret=JBSWY3DPEHPK3PXP',
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useEnrollMfa(), { wrapper });

    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/auth/mfa/enroll');
    expect(result.current.data).toEqual(
      expect.objectContaining({ secret: 'JBSWY3DPEHPK3PXP' }),
    );
  });
});

describe('useConfirmMfa', () => {
  it('verifies the code and invalidates the profile query on success', async () => {
    mockPost.mockResolvedValueOnce({ message: 'MFA enabled' });
    const { qc, wrapper } = createWrapper();
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useConfirmMfa(), { wrapper });

    await act(async () => {
      result.current.mutate('123456');
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith(
      '/auth/mfa/verify',
      { code: '123456' },
      { skipSignOutOn401: true },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['profile'] });
  });

  it('does not invalidate the profile query when the code is rejected (401)', async () => {
    mockPost.mockRejectedValueOnce(new ApiClientError(401, 'Invalid MFA code'));
    const { qc, wrapper } = createWrapper();
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useConfirmMfa(), { wrapper });

    await act(async () => {
      result.current.mutate('000000');
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect((result.current.error as InstanceType<typeof ApiClientError>).statusCode).toBe(401);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('useDisableMfa', () => {
  it('posts the password and invalidates the profile query on success', async () => {
    mockPost.mockResolvedValueOnce({ message: 'MFA disabled' });
    const { qc, wrapper } = createWrapper();
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDisableMfa(), { wrapper });

    await act(async () => {
      result.current.mutate('correct-password-1');
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith(
      '/auth/mfa/disable',
      { password: 'correct-password-1' },
      { skipSignOutOn401: true },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['profile'] });
  });

  it('surfaces a 401 (invalid password) without invalidating the profile query', async () => {
    mockPost.mockRejectedValueOnce(new ApiClientError(401, 'Invalid password'));
    const { qc, wrapper } = createWrapper();
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDisableMfa(), { wrapper });

    await act(async () => {
      result.current.mutate('wrong-password-1');
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect((result.current.error as InstanceType<typeof ApiClientError>).statusCode).toBe(401);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
