import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * A reset link is emailed to ONE account but opened in whatever browser the
 * person has to hand — often one already signed in as somebody else (a shared
 * laptop, an admin's own session). The middleware used to bounce those requests
 * to /search, so the form was unreachable; now the page opens and has to say
 * whose session is actually open, because the header shows the signed-in
 * account while the form acts on the token's owner.
 */

const mockPost = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: { post: (...args: unknown[]) => mockPost(...args) },
  ApiClientError: class ApiClientError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => searchParams,
  usePathname: () => '/reset-password',
}));

interface FakeAuthState {
  isAuthenticated: boolean;
  user: { email: string } | null;
  logout: () => void;
}
let authState: FakeAuthState = {
  isAuthenticated: false,
  user: null,
  logout: vi.fn(),
};
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector?: (state: FakeAuthState) => unknown) =>
    selector ? selector(authState) : authState,
}));

import ResetPasswordPage from './page';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<ResetPasswordPage />, { wrapper: Wrapper });
}

const NOTICE = /you.{0,3}re signed in as/i;

describe('ResetPasswordPage — signed-in notice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams('token=reset-token');
    authState = {
      isAuthenticated: false,
      user: null,
      logout: vi.fn(),
    };
  });

  it('shows the notice, naming the signed-in account, when a session exists', async () => {
    authState = {
      isAuthenticated: true,
      user: { email: 'superadmin@example.com' },
      logout: vi.fn(),
    };
    renderPage();

    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(screen.getByText('superadmin@example.com')).toBeInTheDocument();
    expect(
      screen.getByText(/not necessarily this one/i),
    ).toBeInTheDocument();
  });

  it('hides the notice when there is no session', async () => {
    renderPage();

    // The form still renders — the notice is the only difference.
    expect(await screen.findByLabelText(/^new password$/i)).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it('still renders the reset form while signed in', async () => {
    authState = {
      isAuthenticated: true,
      user: { email: 'superadmin@example.com' },
      logout: vi.fn(),
    };
    renderPage();

    expect(await screen.findByLabelText(/^new password$/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /reset password/i }),
    ).toBeInTheDocument();
  });

  it('does not sign the current session out or switch accounts on reset', async () => {
    const logout = vi.fn();
    authState = {
      isAuthenticated: true,
      user: { email: 'superadmin@example.com' },
      logout,
    };
    mockPost.mockResolvedValue({ success: true });
    renderPage();

    await userEvent.type(
      await screen.findByLabelText(/^new password$/i),
      'brandnewpassword',
    );
    await userEvent.type(
      screen.getByLabelText(/^confirm new password$/i),
      'brandnewpassword',
    );
    await userEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/auth/reset-password', {
        token: 'reset-token',
        newPassword: 'brandnewpassword',
      }),
    );
    // Only the reset call — no logout, no login, no /users/me re-fetch.
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(logout).not.toHaveBeenCalled();
  });

  it('offers an explicit sign-out after a reset made while signed in', async () => {
    authState = {
      isAuthenticated: true,
      user: { email: 'superadmin@example.com' },
      logout: vi.fn(),
    };
    mockPost.mockResolvedValue({ success: true });
    renderPage();

    await userEvent.type(
      await screen.findByLabelText(/^new password$/i),
      'brandnewpassword',
    );
    await userEvent.type(
      screen.getByLabelText(/^confirm new password$/i),
      'brandnewpassword',
    );
    await userEvent.click(screen.getByRole('button', { name: /reset password/i }));

    expect(
      await screen.findByText(/password reset successfully/i),
    ).toBeInTheDocument();
    // Says the current account is untouched, and offers sign-out rather than
    // a /login link that the middleware would bounce back to /search.
    expect(screen.getByText(/that account is\s+unchanged/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /sign out and sign in/i }),
    ).toBeInTheDocument();
  });

  it('keeps the plain sign-in link for signed-out users after a reset', async () => {
    mockPost.mockResolvedValue({ success: true });
    renderPage();

    await userEvent.type(
      await screen.findByLabelText(/^new password$/i),
      'brandnewpassword',
    );
    await userEvent.type(
      screen.getByLabelText(/^confirm new password$/i),
      'brandnewpassword',
    );
    await userEvent.click(screen.getByRole('button', { name: /reset password/i }));

    expect(
      await screen.findByText(/your password has been reset successfully/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute(
      'href',
      '/login',
    );
  });
});
