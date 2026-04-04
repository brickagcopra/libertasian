import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockReplace = vi.fn();
let mockIsAuthenticated = true;
let mockUser: unknown = { fullName: 'User', onboardingCompletedAt: '2026-01-01' };
let mockHasHydrated = true;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/search',
}));

vi.mock('@/stores/auth-store', () => {
  const onFinishCallbacks: Array<() => void> = [];
  return {
    useAuthStore: Object.assign(
      (selector: (s: unknown) => unknown) =>
        selector({ isAuthenticated: mockIsAuthenticated, user: mockUser }),
      {
        persist: {
          onFinishHydration: (cb: () => void) => {
            onFinishCallbacks.push(cb);
            if (mockHasHydrated) cb();
            return () => {};
          },
          hasHydrated: () => mockHasHydrated,
        },
      },
    ),
  };
});

vi.mock('@/lib/constants', () => ({
  ROUTES: { LOGIN: '/login', ONBOARDING: '/onboarding' },
}));

import { AuthGuard } from './auth-guard';

describe('AuthGuard', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockIsAuthenticated = true;
    mockUser = { fullName: 'User', onboardingCompletedAt: '2026-01-01' };
    mockHasHydrated = true;
  });

  it('renders children when authenticated and hydrated', () => {
    render(
      <AuthGuard>
        <div>Protected Content</div>
      </AuthGuard>,
    );
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('shows spinner when not hydrated', () => {
    mockHasHydrated = false;
    const { container } = render(
      <AuthGuard>
        <div>Protected Content</div>
      </AuthGuard>,
    );
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('redirects to login when not authenticated', () => {
    mockIsAuthenticated = false;
    render(
      <AuthGuard>
        <div>Protected Content</div>
      </AuthGuard>,
    );
    expect(mockReplace).toHaveBeenCalledWith('/login');
  });

  it('redirects to onboarding when onboarding not completed', () => {
    mockUser = { fullName: 'New User', onboardingCompletedAt: null };
    render(
      <AuthGuard>
        <div>Protected Content</div>
      </AuthGuard>,
    );
    expect(mockReplace).toHaveBeenCalledWith('/onboarding');
  });

  it('shows spinner when not authenticated', () => {
    mockIsAuthenticated = false;
    const { container } = render(
      <AuthGuard>
        <div>Protected Content</div>
      </AuthGuard>,
    );
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });
});
