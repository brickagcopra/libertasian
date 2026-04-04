import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from './auth-store';

describe('useAuthStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useAuthStore.setState({
      accessToken: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
    });
  });

  it('starts with null tokens and unauthenticated', () => {
    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('setTokens sets tokens and marks authenticated', () => {
    useAuthStore.getState().setTokens('access-123', 'refresh-456');

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('access-123');
    expect(state.refreshToken).toBe('refresh-456');
    expect(state.isAuthenticated).toBe(true);
  });

  it('setUser sets user object', () => {
    const user = {
      id: 'user-1',
      email: 'test@example.com',
      fullName: 'Test User',
      role: 'member',
      organizationId: 'org-1',
      mfaEnabled: false,
      emailVerified: true,
    };

    useAuthStore.getState().setUser(user);

    const state = useAuthStore.getState();
    expect(state.user).toEqual(user);
    expect(state.user?.email).toBe('test@example.com');
  });

  it('logout clears all state', () => {
    // Set up authenticated state
    useAuthStore.getState().setTokens('access-123', 'refresh-456');
    useAuthStore.getState().setUser({
      id: 'user-1',
      email: 'test@example.com',
      fullName: 'Test User',
      role: 'member',
      organizationId: 'org-1',
      mfaEnabled: false,
      emailVerified: true,
    });

    // Verify state is set
    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    // Logout
    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('setTokens does not affect user', () => {
    const user = {
      id: 'user-1',
      email: 'test@example.com',
      fullName: 'Test User',
      role: 'member',
      organizationId: 'org-1',
      mfaEnabled: false,
      emailVerified: true,
    };

    useAuthStore.getState().setUser(user);
    useAuthStore.getState().setTokens('new-access', 'new-refresh');

    const state = useAuthStore.getState();
    expect(state.user).toEqual(user);
    expect(state.accessToken).toBe('new-access');
  });
});
