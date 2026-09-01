import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

// Mock the API client
jest.mock('../lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
    setOnUnauthorized: jest.fn(),
  },
  ApiClientError: class ApiClientError extends Error {
    statusCode: number;
    serverMessage: string;
    constructor(statusCode: number, message: string) {
      super(message);
      this.name = 'ApiClientError';
      this.statusCode = statusCode;
      this.serverMessage = message;
    }
  },
}));

import { apiClient } from '../lib/api-client';
import { storage, STORAGE_KEYS } from '../storage/mmkv';
import { AuthProvider, useAuth } from './auth-provider';

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockGetItemAsync = SecureStore.getItemAsync as jest.MockedFunction<
  typeof SecureStore.getItemAsync
>;
const mockSetItemAsync = SecureStore.setItemAsync as jest.MockedFunction<
  typeof SecureStore.setItemAsync
>;
const mockDeleteItemAsync = SecureStore.deleteItemAsync as jest.MockedFunction<
  typeof SecureStore.deleteItemAsync
>;

const userA = {
  id: '1',
  email: 'test@example.com',
  fullName: 'Test User',
  phone: null,
  status: 'active' as const,
  emailVerified: true,
  mfaEnabled: false,
  onboardingCompletedAt: null,
  userRole: 'user',
  organizationRole: 'member',
  organizationId: 'org-1',
  createdAt: '2024-01-01',
};

const userB = {
  ...userA,
  id: '2',
  email: 'second@example.com',
  fullName: 'Second User',
  organizationId: 'org-2',
};

// Test component that uses the auth context
function TestConsumer() {
  const { user, isAuthenticated, isLoading, signIn, signOut } = useAuth();

  return (
    <>
      <Text testID="loading">{isLoading ? 'loading' : 'ready'}</Text>
      <Text testID="authenticated">{isAuthenticated ? 'yes' : 'no'}</Text>
      <Text testID="user-email">{user?.email ?? 'none'}</Text>
      <TouchableOpacity
        testID="sign-in"
        onPress={() => signIn('access-token', 'refresh-token', userA as never)}
      />
      <TouchableOpacity
        testID="sign-in-b"
        onPress={() => signIn('access-token-b', 'refresh-token-b', userB as never)}
      />
      <TouchableOpacity testID="sign-out" onPress={signOut} />
    </>
  );
}

/**
 * AuthProvider now calls `useQueryClient()`, so it can only be rendered inside
 * a QueryClientProvider — the same nesting `app/_layout.tsx` uses. The client
 * is returned so a test can assert on the cache the provider clears.
 */
function renderProvider() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe('AuthProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no stored tokens
    mockGetItemAsync.mockResolvedValue(null);
    // MMKV is module-level and `clearAllMocks` does not touch it.
    mockSetItemAsync.mockResolvedValue(undefined);
    storage.delete(STORAGE_KEYS.ENTITLED_SURFACES);
  });

  it('provides initial unauthenticated state when no tokens', async () => {
    const { getByTestId } = renderProvider();

    await waitFor(
      () => {
        expect(getByTestId('loading').props.children).toBe('ready');
      },
      { timeout: 10000 },
    );

    expect(getByTestId('authenticated').props.children).toBe('no');
    expect(getByTestId('user-email').props.children).toBe('none');
  });

  it('restores auth state when valid token is stored', async () => {
    mockGetItemAsync.mockImplementation(async (key) => {
      if (key === 'auth_access_token') return 'stored-token';
      return null;
    });
    mockGet.mockResolvedValueOnce({
      id: '1',
      email: 'restored@example.com',
      fullName: 'Restored User',
      phone: null,
      status: 'active',
      emailVerified: true,
      mfaEnabled: false,
      createdAt: '2024-01-01',
    });

    const { getByTestId } = renderProvider();

    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('ready');
    });

    expect(getByTestId('authenticated').props.children).toBe('yes');
    expect(getByTestId('user-email').props.children).toBe('restored@example.com');
  });

  it('clears tokens when stored token is invalid', async () => {
    mockGetItemAsync.mockImplementation(async (key) => {
      if (key === 'auth_access_token') return 'invalid-token';
      return null;
    });
    mockGet.mockRejectedValueOnce(new Error('Invalid token'));

    const { getByTestId } = renderProvider();

    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('ready');
    });

    expect(getByTestId('authenticated').props.children).toBe('no');
    expect(mockDeleteItemAsync).toHaveBeenCalled();
  });

  it('signIn stores tokens and sets user', async () => {
    const { getByTestId } = renderProvider();

    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('ready');
    });

    await act(async () => {
      fireEvent.press(getByTestId('sign-in'));
    });

    await waitFor(() => {
      expect(getByTestId('authenticated').props.children).toBe('yes');
    });

    expect(getByTestId('user-email').props.children).toBe('test@example.com');
    expect(mockSetItemAsync).toHaveBeenCalledWith('auth_access_token', 'access-token');
    expect(mockSetItemAsync).toHaveBeenCalledWith('auth_refresh_token', 'refresh-token');
  });

  it('signOut clears tokens and user', async () => {
    // Start signed in
    const { getByTestId } = renderProvider();

    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('ready');
    });

    // Sign in first
    await act(async () => {
      fireEvent.press(getByTestId('sign-in'));
    });

    await waitFor(() => {
      expect(getByTestId('authenticated').props.children).toBe('yes');
    });

    // Now sign out — resolve stored keys by name (signOut also reads the
    // push token key for best-effort push unregistration).
    mockGetItemAsync.mockImplementation(async (key) =>
      key === 'auth_refresh_token' ? 'refresh-token' : null,
    );
    mockPost.mockResolvedValueOnce(undefined);

    await act(async () => {
      fireEvent.press(getByTestId('sign-out'));
    });

    await waitFor(() => {
      expect(getByTestId('authenticated').props.children).toBe('no');
    });

    expect(getByTestId('user-email').props.children).toBe('none');
    expect(mockDeleteItemAsync).toHaveBeenCalled();
  });
  /**
   * The 1.0.1 blocker.
   *
   * Prod logs: the client never re-fetched `/users/me` after a second account
   * signed in 21s later. `useProfile()` has `staleTime: 5 * 60 * 1000`, so
   * React Query answered from the FIRST account's cache, and
   * `app/settings/index.tsx` (`displayUser = profile ?? user`) preferred that
   * stale profile over the correct auth-context user.
   */
  it('signing out and back in as a different user leaves nothing of the first account', async () => {
    const { getByTestId, queryClient } = renderProvider();

    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('ready');
    });

    await act(async () => {
      fireEvent.press(getByTestId('sign-in'));
    });
    await waitFor(() => {
      expect(getByTestId('authenticated').props.children).toBe('yes');
    });

    // The two things that survived an account switch before this fix: the
    // cached profile query and the persisted entitlement blob.
    queryClient.setQueryData(['profile'], { id: '1', email: 'test@example.com' });
    storage.set(
      STORAGE_KEYS.ENTITLED_SURFACES,
      JSON.stringify({ scan: true, study: true, barExams: true }),
    );

    mockGetItemAsync.mockImplementation(async (key) =>
      key === 'auth_refresh_token' ? 'refresh-token' : null,
    );
    mockPost.mockResolvedValueOnce(undefined);

    await act(async () => {
      fireEvent.press(getByTestId('sign-out'));
    });
    await waitFor(() => {
      expect(getByTestId('authenticated').props.children).toBe('no');
    });

    expect(queryClient.getQueryData(['profile'])).toBeUndefined();
    expect(storage.getString(STORAGE_KEYS.ENTITLED_SURFACES)).toBeUndefined();

    await act(async () => {
      fireEvent.press(getByTestId('sign-in-b'));
    });
    await waitFor(() => {
      expect(getByTestId('user-email').props.children).toBe('second@example.com');
    });

    // Nothing of account A is left for `useProfile()` to answer from, so the
    // next read refetches under the new token.
    expect(queryClient.getQueryData(['profile'])).toBeUndefined();
    expect(storage.getString(STORAGE_KEYS.ENTITLED_SURFACES)).toBeUndefined();
  });

  /**
   * Order, not just the fact of clearing. `signIn` clears BEFORE the new
   * session exists; clearing afterwards would throw away a `/users/me` the new
   * session had already fetched, and leave the stale one answering in the
   * window before that.
   */
  it('signIn clears the previous account cache before writing the new session', async () => {
    const { getByTestId, queryClient } = renderProvider();

    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('ready');
    });

    queryClient.setQueryData(['profile'], { id: '1', email: 'test@example.com' });
    storage.set(STORAGE_KEYS.ENTITLED_SURFACES, JSON.stringify({ scan: true }));

    // Sampled at the moment the new access token is persisted — the first
    // observable step of establishing the new session.
    let profileAtTokenWrite: unknown = 'not-sampled';
    let surfacesAtTokenWrite: unknown = 'not-sampled';
    mockSetItemAsync.mockImplementation(async (key) => {
      if (key === 'auth_access_token') {
        profileAtTokenWrite = queryClient.getQueryData(['profile']);
        surfacesAtTokenWrite = storage.getString(STORAGE_KEYS.ENTITLED_SURFACES);
      }
    });

    await act(async () => {
      fireEvent.press(getByTestId('sign-in-b'));
    });
    await waitFor(() => {
      expect(getByTestId('user-email').props.children).toBe('second@example.com');
    });

    expect(profileAtTokenWrite).toBeUndefined();
    expect(surfacesAtTokenWrite).toBeUndefined();
  });
});
