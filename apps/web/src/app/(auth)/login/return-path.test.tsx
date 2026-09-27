/**
 * The login page honours `?from=` (path AND query) after password sign-in,
 * parks it for the Google OAuth round trip, and refuses anything that is not
 * a same-origin relative path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const mockPost = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: (...args: unknown[]) => mockPost(...args),
  },
  ApiClientError: class ApiClientError extends Error {},
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({
    setAccessToken: vi.fn(),
    setUser: vi.fn(),
  }),
}));

import LoginPage from './page';
import { OAUTH_RETURN_KEY } from '@/features/auth/safe-redirect';

function loginOk(onboarded: boolean) {
  return {
    success: true,
    data: {
      tokens: { accessToken: 'at-123' },
      user: { id: '1', onboardingCompletedAt: onboarded ? '2026-01-01T00:00:00.000Z' : null },
      mfaRequired: false,
    },
  };
}

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

async function signIn() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
  await user.type(screen.getByLabelText('Password'), 'password123');
  await user.click(screen.getByRole('button', { name: /^sign in$/i }));
}

const FROM = '/research?q=doctrine%20of%20estoppel&mode=deep';

describe('Login return path (?from=)', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockPost.mockReset();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
    vi.unstubAllEnvs();
  });

  it('returns to path + query after sign-in', async () => {
    mockPost.mockResolvedValueOnce(loginOk(true));
    renderAt(`?from=${encodeURIComponent(FROM)}`);
    await signIn();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(FROM));
  });

  it('carries path + query through onboarding for a new account', async () => {
    mockPost.mockResolvedValueOnce(loginOk(false));
    renderAt(`?from=${encodeURIComponent(FROM)}`);
    await signIn();
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(`/onboarding?from=${encodeURIComponent(FROM)}`),
    );
  });

  it.each([
    '//evil.com/research?q=x',
    '/\\evil.com',
    'https://evil.com/research',
    'javascript:alert(1)',
    '/%2F%2Fevil.com',
    '/%5Cevil.com',
  ])('ignores the unsafe target %s and lands on /search', async (bad) => {
    mockPost.mockResolvedValueOnce(loginOk(true));
    renderAt(`?from=${encodeURIComponent(bad)}`);
    await signIn();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/search'));
  });

  it('parks ?from= for the Google OAuth round trip', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_AUTH_ENABLED', 'true');
    renderAt(`?from=${encodeURIComponent(FROM)}`);
    const link = screen.getByTestId('google-sign-in');
    link.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(link);
    expect(window.sessionStorage.getItem(OAUTH_RETURN_KEY)).toBe(FROM);
  });

  it('does not park an unsafe ?from= for OAuth', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_AUTH_ENABLED', 'true');
    window.sessionStorage.setItem(OAUTH_RETURN_KEY, '/stale');
    renderAt(`?from=${encodeURIComponent('//evil.com')}`);
    const link = screen.getByTestId('google-sign-in');
    link.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(link);
    expect(window.sessionStorage.getItem(OAUTH_RETURN_KEY)).toBeNull();
  });
});
