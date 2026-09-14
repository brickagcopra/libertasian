import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * The organization invite email's "Accept Invitation" link lands here.
 *
 * It previously pointed at /organizations/accept-invite with no token and no
 * such page, so every invite 307'd to /login. These tests pin the behaviour
 * that makes the link usable: the token is read from the URL, the invite is
 * described before it is accepted, and expired/used tokens are explained
 * rather than thrown as errors.
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
  usePathname: () => '/accept-invite',
}));

let isAuthenticated = false;
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated }),
}));

import AcceptInvitePage from './page';

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
  return render(<AcceptInvitePage />, { wrapper: Wrapper });
}

const VALID_INVITE = {
  success: true,
  data: {
    email: 'invitee@example.com',
    role: 'admin',
    organizationName: 'Santos Law Office',
    expired: false,
    accepted: false,
  },
};

describe('AcceptInvitePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams('token=raw-invite-token');
    isAuthenticated = false;
  });

  it('looks the invite up with the token from the URL', async () => {
    mockPost.mockResolvedValue(VALID_INVITE);
    renderPage();

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/auth/invite/lookup', {
        token: 'raw-invite-token',
      }),
    );
  });

  it('shows the organization name and role', async () => {
    mockPost.mockResolvedValue(VALID_INVITE);
    renderPage();

    expect(await screen.findByText('Santos Law Office')).toBeInTheDocument();
    expect(await screen.findByText('admin')).toBeInTheDocument();
  });

  it('routes an invitee with no session to register with the email prefilled', async () => {
    mockPost.mockResolvedValue(VALID_INVITE);
    renderPage();

    const createAccount = await screen.findByRole('link', {
      name: /create an account/i,
    });
    const href = createAccount.getAttribute('href') ?? '';
    expect(href).toContain('/register?');
    expect(href).toContain('email=invitee%40example.com');
    // ...and carries the way back here, so the invite survives registration.
    expect(href).toContain(
      `from=${encodeURIComponent('/accept-invite?token=raw-invite-token')}`,
    );
  });

  it('accepts the invite for a signed-in user', async () => {
    isAuthenticated = true;
    mockPost.mockResolvedValueOnce(VALID_INVITE).mockResolvedValueOnce({ success: true });
    renderPage();

    const button = await screen.findByRole('button', { name: /accept invitation/i });
    await userEvent.click(button);

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/auth/accept-invite', {
        token: 'raw-invite-token',
      }),
    );
    expect(await screen.findByText(/you.{0,3}ve joined/i)).toBeInTheDocument();
  });

  it('explains an expired token in plain language instead of erroring', async () => {
    mockPost.mockResolvedValue({
      ...VALID_INVITE,
      data: { ...VALID_INVITE.data, expired: true },
    });
    renderPage();

    expect(await screen.findByText(/has\s+expired/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
  });

  it('explains an already-used token', async () => {
    mockPost.mockResolvedValue({
      ...VALID_INVITE,
      data: { ...VALID_INVITE.data, accepted: true },
    });
    renderPage();

    expect(await screen.findByText(/already been used/i)).toBeInTheDocument();
  });

  it('explains an unknown token without exposing the API error', async () => {
    mockPost.mockRejectedValue(new Error('Invite not found'));
    renderPage();

    expect(
      await screen.findByText(/couldn.{0,3}t find this invitation/i),
    ).toBeInTheDocument();
  });

  it('tells the user what to do when the link carries no token', async () => {
    searchParams = new URLSearchParams();
    renderPage();

    expect(
      await screen.findByText(/missing its invitation code/i),
    ).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });
});
