import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * An invitee arriving from /accept-invite lands on /register with the invited
 * email in the query string. Prefilling it matters for correctness, not just
 * convenience: the pending invite is keyed to that exact address, so an account
 * registered under a different one cannot redeem it.
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => '/register',
}));

import RegisterPage from './page';

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
  return render(<RegisterPage />, { wrapper: Wrapper });
}

describe('RegisterPage invite prefill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/register');
  });

  it('prefills the email from ?email=', () => {
    window.history.replaceState({}, '', '/register?email=invitee%40example.com');
    renderPage();

    expect(screen.getByLabelText(/email address/i)).toHaveValue(
      'invitee@example.com',
    );
  });

  it('leaves the email empty for an ordinary sign-up', () => {
    renderPage();

    expect(screen.getByLabelText(/email address/i)).toHaveValue('');
  });
});
