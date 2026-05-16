import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const mockReplace = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/auth/callback',
  useParams: () => ({}),
}));

const mockSetAccessToken = vi.fn();
const mockSetUser = vi.fn();
const mockLogout = vi.fn();

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    () => ({
      setAccessToken: mockSetAccessToken,
      setUser: mockSetUser,
    }),
    {
      getState: () => ({
        logout: mockLogout,
      }),
    },
  ),
}));

const mockGet = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

import OAuthCallbackPage from './page';

const SAMPLE_USER = {
  id: 'user-1',
  email: 'jane@example.com',
  fullName: 'Jane Doe',
  role: 'member',
  organizationId: 'org-1',
  mfaEnabled: false,
  emailVerified: true,
  onboardingCompletedAt: null,
  userRole: null,
};

function setSearchParam(key: string, value: string | null) {
  for (const k of Array.from(mockSearchParams.keys())) mockSearchParams.delete(k);
  if (value !== null) mockSearchParams.set(key, value);
}

describe('OAuthCallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSearchParam('accessToken', null);
  });

  it('redirects to /login when no access token is present', async () => {
    render(<OAuthCallbackPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/login');
    });
    expect(mockSetAccessToken).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('on success: stores token, fetches /users/me, sets user, redirects to /search', async () => {
    setSearchParam('accessToken', 'at-abc');
    mockGet.mockResolvedValueOnce({ success: true, data: SAMPLE_USER });

    render(<OAuthCallbackPage />);

    await waitFor(() => {
      expect(mockSetAccessToken).toHaveBeenCalledWith('at-abc');
      expect(mockGet).toHaveBeenCalledWith('/users/me');
      expect(mockSetUser).toHaveBeenCalledWith(SAMPLE_USER);
      expect(mockReplace).toHaveBeenCalledWith('/search');
    });
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('on /users/me failure: logs out and redirects to /login?error=auth_failed', async () => {
    setSearchParam('accessToken', 'at-abc');
    mockGet.mockRejectedValueOnce(new Error('boom'));

    render(<OAuthCallbackPage />);

    await waitFor(() => {
      expect(mockSetAccessToken).toHaveBeenCalledWith('at-abc');
      expect(mockGet).toHaveBeenCalledWith('/users/me');
      expect(mockLogout).toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith('/login?error=auth_failed');
    });
    expect(mockSetUser).not.toHaveBeenCalled();
  });
});
