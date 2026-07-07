import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    setOnUnauthorized: jest.fn(),
  },
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

const mockSignOut = jest.fn().mockResolvedValue(undefined);
const mockAuthUser = {
  id: 'u1',
  fullName: 'Juan Cruz',
  email: 'juan@libertasian.com',
  emailVerified: true,
  mfaEnabled: false,
  organizationRole: 'member' as const,
  organizationId: 'org1',
  userRole: null,
  createdAt: '2024-01-15T00:00:00Z',
};
jest.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({
    user: mockAuthUser,
    signIn: jest.fn(),
    signOut: mockSignOut,
    isAuthenticated: true,
    isLoading: false,
    setUser: jest.fn(),
  }),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
}));

import { router } from 'expo-router';
import { apiClient, ApiClientError } from '@/lib/api-client';
import SecurityRoute from '@/app/settings/security';

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const alertMock = Alert.alert as jest.MockedFunction<typeof Alert.alert>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function fillChangePasswordForm(
  utils: ReturnType<typeof render>,
  { current = 'old-password-1', next = 'new-password-1', confirm = 'new-password-1' } = {},
) {
  fireEvent.changeText(utils.getByPlaceholderText('Enter current password'), current);
  fireEvent.changeText(utils.getByPlaceholderText('At least 10 characters'), next);
  fireEvent.changeText(utils.getByPlaceholderText('Re-enter new password'), confirm);
}

describe('SecurityRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockAuthUser as Record<string, unknown>).mfaEnabled = false;
    mockGet.mockResolvedValue({ ...mockAuthUser });
  });

  it('renders change-password and MFA cards (MFA off)', () => {
    const { getByText } = render(<SecurityRoute />, { wrapper: createWrapper() });

    expect(getByText('Change password')).toBeTruthy();
    expect(getByText('Two-factor authentication')).toBeTruthy();
    expect(getByText('Enable MFA')).toBeTruthy();
    expect(getByText('Off')).toBeTruthy();
  });

  it('blocks submit when passwords do not match', () => {
    const utils = render(<SecurityRoute />, { wrapper: createWrapper() });
    fillChangePasswordForm(utils, { confirm: 'different-password' });

    fireEvent.press(utils.getByText('Update password'));

    expect(utils.getByText('Passwords do not match')).toBeTruthy();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('blocks submit when the new password is too short', () => {
    const utils = render(<SecurityRoute />, { wrapper: createWrapper() });
    fillChangePasswordForm(utils, { next: 'short', confirm: 'short' });

    fireEvent.press(utils.getByText('Update password'));

    expect(utils.getByText('New password must be at least 10 characters')).toBeTruthy();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('blocks submit when the new password equals the current one', () => {
    const utils = render(<SecurityRoute />, { wrapper: createWrapper() });
    fillChangePasswordForm(utils, {
      current: 'same-password-1',
      next: 'same-password-1',
      confirm: 'same-password-1',
    });

    fireEvent.press(utils.getByText('Update password'));

    expect(utils.getByText('New password must differ from your current password')).toBeTruthy();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows an inline error on 401 (wrong current password)', async () => {
    mockPost.mockRejectedValueOnce(new ApiClientError(401, 'Unauthorized'));
    const utils = render(<SecurityRoute />, { wrapper: createWrapper() });
    fillChangePasswordForm(utils);

    fireEvent.press(utils.getByText('Update password'));

    await waitFor(() =>
      expect(utils.getByText('Current password is incorrect')).toBeTruthy(),
    );
    expect(mockPost).toHaveBeenCalledWith(
      '/auth/change-password',
      { currentPassword: 'old-password-1', newPassword: 'new-password-1' },
      { skipSignOutOn401: true },
    );
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('signs the user out and routes to login after a successful password change', async () => {
    mockPost.mockResolvedValueOnce({ message: 'Password changed' });
    const utils = render(<SecurityRoute />, { wrapper: createWrapper() });
    fillChangePasswordForm(utils);

    fireEvent.press(utils.getByText('Update password'));

    await waitFor(() =>
      expect(alertMock).toHaveBeenCalledWith(
        'Password updated',
        expect.stringContaining('Signing you out'),
        expect.any(Array),
      ),
    );

    const buttons = alertMock.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    buttons.find((b) => b.text === 'OK')?.onPress?.();

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(auth)/login'));
  });

  it('runs the MFA enroll flow: secret shown, code verified, success alert', async () => {
    mockPost
      .mockResolvedValueOnce({
        secret: 'JBSWY3DPEHPK3PXP',
        otpauthUrl: 'otpauth://totp/Libertasian:juan@libertasian.com?secret=JBSWY3DPEHPK3PXP',
      })
      .mockResolvedValueOnce({ message: 'MFA enabled' });

    const utils = render(<SecurityRoute />, { wrapper: createWrapper() });

    fireEvent.press(utils.getByText('Enable MFA'));
    await waitFor(() => expect(utils.getByText('JBSWY3DPEHPK3PXP')).toBeTruthy());
    expect(mockPost).toHaveBeenCalledWith('/auth/mfa/enroll');

    fireEvent.changeText(utils.getByPlaceholderText('000000'), '123456');
    fireEvent.press(utils.getByText('Verify & enable'));

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        '/auth/mfa/verify',
        { code: '123456' },
        { skipSignOutOn401: true },
      ),
    );
    await waitFor(() =>
      expect(alertMock).toHaveBeenCalledWith(
        'MFA enabled',
        expect.stringContaining('Two-factor authentication is now active'),
      ),
    );
  });

  it('strips non-digits from the MFA code input', async () => {
    mockPost.mockResolvedValueOnce({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUrl: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP',
    });
    const utils = render(<SecurityRoute />, { wrapper: createWrapper() });

    fireEvent.press(utils.getByText('Enable MFA'));
    await waitFor(() => expect(utils.getByPlaceholderText('000000')).toBeTruthy());

    const codeInput = utils.getByPlaceholderText('000000');
    fireEvent.changeText(codeInput, '12a34b5678');
    expect(codeInput.props.value).toBe('123456');
  });

  it('shows an inline error when the MFA code is rejected (401)', async () => {
    mockPost
      .mockResolvedValueOnce({
        secret: 'JBSWY3DPEHPK3PXP',
        otpauthUrl: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP',
      })
      .mockRejectedValueOnce(new ApiClientError(401, 'Invalid MFA code'));

    const utils = render(<SecurityRoute />, { wrapper: createWrapper() });

    fireEvent.press(utils.getByText('Enable MFA'));
    await waitFor(() => expect(utils.getByPlaceholderText('000000')).toBeTruthy());

    fireEvent.changeText(utils.getByPlaceholderText('000000'), '000000');
    fireEvent.press(utils.getByText('Verify & enable'));

    await waitFor(() =>
      expect(utils.getByText('Invalid MFA code. Please try again.')).toBeTruthy(),
    );
  });

  it('requires a password and a destructive confirmation to disable MFA', async () => {
    (mockAuthUser as Record<string, unknown>).mfaEnabled = true;
    mockGet.mockResolvedValue({ ...mockAuthUser, mfaEnabled: true });
    mockPost.mockResolvedValueOnce({ message: 'MFA disabled' });

    const utils = render(<SecurityRoute />, { wrapper: createWrapper() });

    fireEvent.press(utils.getByText('Disable MFA'));
    await waitFor(() =>
      expect(utils.getByPlaceholderText('Enter your password')).toBeTruthy(),
    );

    fireEvent.changeText(utils.getByPlaceholderText('Enter your password'), 'correct-password-1');
    fireEvent.press(utils.getByText('Disable MFA'));

    await waitFor(() =>
      expect(alertMock).toHaveBeenCalledWith(
        'Disable MFA?',
        expect.any(String),
        expect.any(Array),
      ),
    );
    expect(mockPost).not.toHaveBeenCalled();

    const buttons = alertMock.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    buttons.find((b) => b.text === 'Disable')?.onPress?.();

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        '/auth/mfa/disable',
        { password: 'correct-password-1' },
        { skipSignOutOn401: true },
      ),
    );
  });

  it('shows an inline error when the disable password is rejected (401)', async () => {
    (mockAuthUser as Record<string, unknown>).mfaEnabled = true;
    mockGet.mockResolvedValue({ ...mockAuthUser, mfaEnabled: true });
    mockPost.mockRejectedValueOnce(new ApiClientError(401, 'Invalid password'));

    const utils = render(<SecurityRoute />, { wrapper: createWrapper() });

    fireEvent.press(utils.getByText('Disable MFA'));
    await waitFor(() =>
      expect(utils.getByPlaceholderText('Enter your password')).toBeTruthy(),
    );

    fireEvent.changeText(utils.getByPlaceholderText('Enter your password'), 'wrong-password-1');
    fireEvent.press(utils.getByText('Disable MFA'));

    await waitFor(() => expect(alertMock).toHaveBeenCalled());
    const buttons = alertMock.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    buttons.find((b) => b.text === 'Disable')?.onPress?.();

    await waitFor(() => expect(utils.getByText('Invalid password')).toBeTruthy());
  });
});
