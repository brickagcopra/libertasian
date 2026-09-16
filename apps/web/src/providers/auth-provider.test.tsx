import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// Mock state
let mockState = {
  isAuthenticated: false,
  accessToken: null as string | null,
  user: null as Record<string, unknown> | null,
};

const mockLogout = vi.fn();
const mockSetAuthReady = vi.fn();
const mockSetUser = vi.fn();

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        logout: mockLogout,
        isAuthenticated: mockState.isAuthenticated,
        accessToken: mockState.accessToken,
        user: mockState.user,
      }),
    {
      getState: () => ({
        ...mockState,
        logout: mockLogout,
        setAuthReady: mockSetAuthReady,
        setAccessToken: vi.fn(),
        setUser: mockSetUser,
      }),
    },
  ),
}));

const mockRefresh = vi.fn();
const mockConfigure = vi.fn();
const mockGet = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    configure: (...args: unknown[]) => mockConfigure(...args),
    refresh: () => mockRefresh(),
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

import { AuthProvider } from './auth-provider';

describe('AuthProvider bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState = { isAuthenticated: false, accessToken: null, user: null };
  });

  it('sets isAuthReady to true immediately when no user is persisted', async () => {
    mockState = { isAuthenticated: false, accessToken: null, user: null };

    render(
      <AuthProvider>
        <div>Child</div>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockSetAuthReady).toHaveBeenCalledWith(true);
    });
    // Should not attempt refresh when not authenticated
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('refreshes proactively and sets isAuthReady on success', async () => {
    mockState = { isAuthenticated: true, accessToken: null, user: { id: 'u1' } };
    mockRefresh.mockResolvedValue('new-token');

    render(
      <AuthProvider>
        <div>Child</div>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(mockSetAuthReady).toHaveBeenCalledWith(true);
    });
    // Should not logout on success
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('sets isAuthReady to true even when refresh fails (no UI deadlock)', async () => {
    mockState = { isAuthenticated: true, accessToken: null, user: null };
    mockRefresh.mockRejectedValue(new Error('Network error'));

    render(
      <AuthProvider>
        <div>Child</div>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(mockSetAuthReady).toHaveBeenCalledWith(true);
    });
  });

  it('logs out when refresh returns null (expired cookie)', async () => {
    mockState = { isAuthenticated: true, accessToken: null, user: null };
    mockRefresh.mockResolvedValue(null);

    render(
      <AuthProvider>
        <div>Child</div>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(mockLogout).toHaveBeenCalled();
      expect(mockSetAuthReady).toHaveBeenCalledWith(true);
    });
  });

  it('skips refresh when accessToken already exists in memory', async () => {
    mockState = { isAuthenticated: true, accessToken: 'existing-token', user: { id: 'u1' } };

    render(
      <AuthProvider>
        <div>Child</div>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockSetAuthReady).toHaveBeenCalledWith(true);
    });
    // Should not refresh when token already exists
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('fetches /users/me and populates user when refresh succeeds but user slice is empty', async () => {
    mockState = { isAuthenticated: true, accessToken: null, user: null };
    mockRefresh.mockResolvedValue('new-token');
    const sampleUser = {
      id: 'user-1',
      email: 'jane@example.com',
      fullName: 'Jane',
      role: 'member',
      organizationId: 'org-1',
      mfaEnabled: false,
      emailVerified: true,
      onboardingCompletedAt: null,
      userRole: null,
    };
    mockGet.mockResolvedValue({ success: true, data: sampleUser });

    render(
      <AuthProvider>
        <div>Child</div>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith('/users/me');
      expect(mockSetUser).toHaveBeenCalledWith(sampleUser);
      expect(mockSetAuthReady).toHaveBeenCalledWith(true);
    });
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('overwrites a stale persisted user with the server profile after refresh', async () => {
    // Stale localStorage user claims platform admin; the server has since revoked it.
    mockState = {
      isAuthenticated: true,
      accessToken: null,
      user: { id: 'user-1', isPlatformAdmin: true },
    };
    mockRefresh.mockResolvedValue('new-token');
    const serverUser = {
      id: 'user-1',
      email: 'jane@example.com',
      fullName: 'Jane',
      role: 'member',
      organizationId: 'org-1',
      mfaEnabled: false,
      emailVerified: true,
      onboardingCompletedAt: null,
      userRole: null,
      isPlatformAdmin: false,
    };
    mockGet.mockResolvedValue({ success: true, data: serverUser });

    render(
      <AuthProvider>
        <div>Child</div>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/users/me');
      expect(mockSetUser).toHaveBeenCalledWith(serverUser);
      expect(mockSetAuthReady).toHaveBeenCalledWith(true);
    });
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('does not logout when /users/me fetch fails after a successful refresh', async () => {
    mockState = { isAuthenticated: true, accessToken: null, user: null };
    mockRefresh.mockResolvedValue('new-token');
    mockGet.mockRejectedValue(new Error('boom'));

    render(
      <AuthProvider>
        <div>Child</div>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/users/me');
      expect(mockSetAuthReady).toHaveBeenCalledWith(true);
    });
    expect(mockLogout).not.toHaveBeenCalled();
    expect(mockSetUser).not.toHaveBeenCalled();
  });
});

/**
 * The production outage: an analytics beacon 401'd on the public landing page,
 * `onUnauthorized` ran, and every anonymous visitor was hard-navigated to
 * /login seconds after arriving. The old exemption covered only /login and
 * /register — commit 6a19554 patched the login page and the same bug came
 * straight back everywhere else. The allowlist now comes from the same module
 * the Edge middleware reads, and it is NOT mocked here: these tests exercise
 * the real `isPublicRoute`.
 */
describe('AuthProvider onUnauthorized', () => {
  /** Captured `window.location` replacement so `href =` records instead of navigating. */
  let location: { pathname: string; href: string };

  function onUnauthorized(): () => void {
    render(
      <AuthProvider>
        <div>Child</div>
      </AuthProvider>,
    );
    const config = mockConfigure.mock.calls[0]?.[0] as { onUnauthorized: () => void };
    return config.onUnauthorized;
  }

  function atPath(pathname: string): void {
    location = { pathname, href: `https://libertasian.com${pathname}` };
    Object.defineProperty(window, 'location', {
      value: location,
      writable: true,
      configurable: true,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockState = { isAuthenticated: false, accessToken: null, user: null };
  });

  const publicPaths = [
    '/',
    '/about',
    '/pricing',
    '/terms',
    '/privacy',
    '/contact',
    '/refund-policy',
    '/account-deletion',
    '/restore-account',
    '/login',
    '/register',
    '/reset-password',
    '/accept-invite',
    '/blog/how-to-cite',
    '/shared/abc123',
    '/billing/mobile/success',
  ];

  for (const path of publicPaths) {
    it(`clears auth state without navigating away from ${path}`, () => {
      atPath(path);
      const handler = onUnauthorized();

      handler();

      expect(mockLogout).toHaveBeenCalledTimes(1);
      expect(location.href).toBe(`https://libertasian.com${path}`);
    });
  }

  const protectedPaths = ['/search', '/digests', '/settings/billing', '/admin'];

  for (const path of protectedPaths) {
    it(`still redirects to /login from the protected route ${path}`, () => {
      atPath(path);
      const handler = onUnauthorized();

      handler();

      expect(mockLogout).toHaveBeenCalledTimes(1);
      expect(location.href).toBe('/login');
    });
  }

  it('treats a trailing-slash public path as public', () => {
    // Next.js can serve /about/ as well as /about; the two must not disagree.
    atPath('/about/');
    const handler = onUnauthorized();

    handler();

    expect(location.href).toBe('https://libertasian.com/about/');
  });
});
