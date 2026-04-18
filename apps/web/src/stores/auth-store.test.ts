import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from './auth-store';

describe('useAuthStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isAuthReady: false,
    });
  });

  it('starts with null token and unauthenticated', () => {
    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('setAccessToken sets token and marks authenticated', () => {
    useAuthStore.getState().setAccessToken('access-123');

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('access-123');
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
      onboardingCompletedAt: null,
      userRole: null,
    };

    useAuthStore.getState().setUser(user);

    const state = useAuthStore.getState();
    expect(state.user).toEqual(user);
    expect(state.user?.email).toBe('test@example.com');
  });

  it('logout clears all state', () => {
    // Set up authenticated state
    useAuthStore.getState().setAccessToken('access-123');
    useAuthStore.getState().setUser({
      id: 'user-1',
      email: 'test@example.com',
      fullName: 'Test User',
      role: 'member',
      organizationId: 'org-1',
      mfaEnabled: false,
      emailVerified: true,
      onboardingCompletedAt: null,
      userRole: null,
    });

    // Verify state is set
    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    // Logout
    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('isAuthReady defaults to false', () => {
    expect(useAuthStore.getState().isAuthReady).toBe(false);
  });

  it('setAuthReady flips isAuthReady flag', () => {
    useAuthStore.getState().setAuthReady(true);
    expect(useAuthStore.getState().isAuthReady).toBe(true);

    useAuthStore.getState().setAuthReady(false);
    expect(useAuthStore.getState().isAuthReady).toBe(false);
  });

  it('isAuthReady is NOT included in persisted state', () => {
    // The partialize function only includes user and isAuthenticated.
    // Verify by checking the store's persist options.
    const persistOptions = useAuthStore.persist.getOptions();
    const partialize = persistOptions.partialize!;

    const fakeState = {
      accessToken: 'tok',
      user: null,
      isAuthenticated: true,
      isAuthReady: true,
      setAccessToken: () => {},
      setUser: () => {},
      setAuthReady: () => {},
      logout: () => {},
    };

    const persisted = partialize(fakeState);
    expect(persisted).not.toHaveProperty('isAuthReady');
    expect(persisted).not.toHaveProperty('accessToken');
    expect(persisted).toHaveProperty('user');
    expect(persisted).toHaveProperty('isAuthenticated');
  });

  it('setAccessToken does not affect user', () => {
    const user = {
      id: 'user-1',
      email: 'test@example.com',
      fullName: 'Test User',
      role: 'member',
      organizationId: 'org-1',
      mfaEnabled: false,
      emailVerified: true,
      onboardingCompletedAt: null,
      userRole: null,
    };

    useAuthStore.getState().setUser(user);
    useAuthStore.getState().setAccessToken('new-access');

    const state = useAuthStore.getState();
    expect(state.user).toEqual(user);
    expect(state.accessToken).toBe('new-access');
  });
});
