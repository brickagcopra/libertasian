/**
 * A password sign-in refused with EMAIL_NOT_VERIFIED goes straight to the
 * code page (the API has just emailed a fresh code), keeping ?from=.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/login',
  useSearchParams: () => new URLSearchParams(window.location.search),
  useParams: () => ({}),
}));

const { MockApiClientError } = vi.hoisted(() => ({
  MockApiClientError: class MockApiClientError extends Error {
    constructor(
      message: string,
      public statusCode: number,
      public body?: unknown,
    ) {
      super(message);
    }
  },
}));

const mockPost = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: { post: (...args: unknown[]) => mockPost(...args) },
  ApiClientError: MockApiClientError,
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({ setAccessToken: vi.fn(), setUser: vi.fn() }),
}));

import LoginPage from './page';

function renderAt(search: string) {
  window.history.pushState({}, '', `/login${search}`);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LoginPage />
    </QueryClientProvider>,
  );
}

async function signIn(email: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/email address/i), email);
  await user.type(screen.getByLabelText('Password'), 'password123');
  await user.click(screen.getByRole('button', { name: /^sign in$/i }));
}

describe('Login with an unverified email', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockPost.mockReset();
  });

  it('routes to /verify-email with the address and the deep link', async () => {
    mockPost.mockRejectedValue(
      new MockApiClientError('Please verify your email', 400, { code: 'EMAIL_NOT_VERIFIED' }),
    );
    renderAt('?from=%2Fsettings%2Fbilling');
    await signIn('Juan@Example.com');

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const target = new URL(mockPush.mock.calls[0]![0] as string, 'http://x');
    expect(target.pathname).toBe('/verify-email');
    expect(target.searchParams.get('email')).toBe('juan@example.com');
    expect(target.searchParams.get('from')).toBe('/settings/billing');
  });

  it('shows other errors inline instead', async () => {
    mockPost.mockRejectedValue(new MockApiClientError('Invalid email or password', 401));
    renderAt('');
    await signIn('juan@example.com');

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
