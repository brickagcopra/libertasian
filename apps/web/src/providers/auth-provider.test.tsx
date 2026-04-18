import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// Mock state
let mockState = {
  isAuthenticated: false,
  accessToken: null as string | null,
};

const mockLogout = vi.fn();
const mockSetAuthReady = vi.fn();

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        logout: mockLogout,
        isAuthenticated: mockState.isAuthenticated,
        accessToken: mockState.accessToken,
      }),
    {
      getState: () => ({
        ...mockState,
        logout: mockLogout,
        setAuthReady: mockSetAuthReady,
        setAccessToken: vi.fn(),
      }),
    },
  ),
}));

const mockRefresh = vi.fn();
const mockConfigure = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    configure: (...args: unknown[]) => mockConfigure(...args),
    refresh: () => mockRefresh(),
  },
}));

import { AuthProvider } from './auth-provider';

describe('AuthProvider bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState = { isAuthenticated: false, accessToken: null };
  });

  it('sets isAuthReady to true immediately when no user is persisted', async () => {
    mockState = { isAuthenticated: false, accessToken: null };

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
    mockState = { isAuthenticated: true, accessToken: null };
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
    mockState = { isAuthenticated: true, accessToken: null };
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
    mockState = { isAuthenticated: true, accessToken: null };
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
    mockState = { isAuthenticated: true, accessToken: 'existing-token' };

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
});
