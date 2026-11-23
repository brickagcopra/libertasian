import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockVerify = jest.fn();
const mockResend = jest.fn();
jest.mock('@/features/auth/hooks/use-auth', () => ({
  useVerifyEmail: () => ({ mutateAsync: mockVerify, isPending: false }),
  useResendVerification: () => ({ mutateAsync: mockResend, isPending: false }),
}));

jest.mock('@/lib/api-client', () => ({
  ApiClientError: class ApiClientError extends Error {
    statusCode: number;
    serverMessage: string;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
      this.serverMessage = message;
    }
  },
}));

let mockParams: Record<string, string> = { email: 'Juan@Test.com' };
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

import { ApiClientError } from '@/lib/api-client';
import VerifyEmailScreen from '@/app/(auth)/verify-email';

describe('VerifyEmailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { email: 'Juan@Test.com' };
  });

  it('submits the code automatically once six digits are typed', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    mockVerify.mockResolvedValueOnce({});
    const { getByTestId } = render(<VerifyEmailScreen />);

    await act(async () => {
      fireEvent.changeText(getByTestId('verify-code-input'), '12 34-56');
    });

    expect(mockVerify).toHaveBeenCalledWith({ email: 'juan@test.com', code: '123456' });
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Email verified', expect.any(String), expect.any(Array)),
    );
  });

  it('shows the server message for a wrong or expired code', async () => {
    mockVerify.mockRejectedValueOnce(new ApiClientError(400, 'Invalid verification code'));
    const { getByTestId, findByText } = render(<VerifyEmailScreen />);

    await act(async () => {
      fireEvent.changeText(getByTestId('verify-code-input'), '000000');
    });

    expect(await findByText('Invalid verification code')).toBeTruthy();
  });

  it('holds the resend button during the cooldown', () => {
    const { getByText } = render(<VerifyEmailScreen />);
    fireEvent.press(getByText(/Resend code in \d+s/));
    expect(mockResend).not.toHaveBeenCalled();
  });

  it('explains the email link when opened without an address', () => {
    mockParams = {};
    const { getByText, queryByTestId } = render(<VerifyEmailScreen />);
    expect(queryByTestId('verify-code-input')).toBeNull();
    expect(getByText(/tap its link/)).toBeTruthy();
  });
});
