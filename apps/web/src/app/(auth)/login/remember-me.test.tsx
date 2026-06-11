/**
 * RTL coverage for the "Keep me signed in" choice on the login form.
 *
 * Verifies the checkbox renders checked by default and that its value flows
 * through to the POST /auth/login request body — true when left checked,
 * false when the user unchecks it (session-cookie path for shared computers).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

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
    setAccessToken: vi.fn(),
    setUser: vi.fn(),
  }),
}));

import LoginPage from './page';

const loginOk = {
  success: true,
  data: {
    tokens: { accessToken: 'at-123' },
    user: { id: '1', onboardingCompletedAt: '2026-01-01T00:00:00.000Z' },
    mfaRequired: false,
  },
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LoginPage />
    </QueryClientProvider>,
  );
}

async function fillCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
  await user.type(screen.getByLabelText('Password'), 'password123');
}

describe('Login "Keep me signed in" checkbox', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it('renders checked by default', () => {
    renderPage();
    expect(
      screen.getByRole('checkbox', { name: /keep me signed in/i }),
    ).toBeChecked();
  });

  it('sends rememberMe:true when left checked', async () => {
    mockPost.mockResolvedValueOnce(loginOk);
    const user = userEvent.setup();
    renderPage();

    await fillCredentials(user);
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(mockPost).toHaveBeenCalledWith(
      '/auth/login',
      expect.objectContaining({
        email: 'test@example.com',
        password: 'password123',
        rememberMe: true,
      }),
    );
  });

  it('sends rememberMe:false after the user unchecks it', async () => {
    mockPost.mockResolvedValueOnce(loginOk);
    const user = userEvent.setup();
    renderPage();

    const checkbox = screen.getByRole('checkbox', { name: /keep me signed in/i });
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();

    await fillCredentials(user);
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(mockPost).toHaveBeenCalledWith(
      '/auth/login',
      expect.objectContaining({ rememberMe: false }),
    );
  });
});
