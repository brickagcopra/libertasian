import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

// Mock the API client
jest.mock('../lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
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
        onPress={() =>
          signIn('access-token', 'refresh-token', {
            id: '1',
            email: 'test@example.com',
            fullName: 'Test User',
            phone: null,
            status: 'active',
            emailVerified: true,
            mfaEnabled: false,
            onboardingCompletedAt: null,
            userRole: 'user',
            organizationRole: 'member',
            organizationId: 'org-1',
            createdAt: '2024-01-01',
          })
        }
      />
      <TouchableOpacity testID="sign-out" onPress={signOut} />
    </>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no stored tokens
    mockGetItemAsync.mockResolvedValue(null);
  });

  it('provides initial unauthenticated state when no tokens', async () => {
    const { getByTestId } = render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

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
      success: true,
      data: {
        id: '1',
        email: 'restored@example.com',
        fullName: 'Restored User',
        phone: null,
        status: 'active',
        emailVerified: true,
        mfaEnabled: false,
        createdAt: '2024-01-01',
      },
    });

    const { getByTestId } = render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

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

    const { getByTestId } = render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('ready');
    });

    expect(getByTestId('authenticated').props.children).toBe('no');
    expect(mockDeleteItemAsync).toHaveBeenCalled();
  });

  it('signIn stores tokens and sets user', async () => {
    const { getByTestId } = render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

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
    const { getByTestId } = render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

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

    // Now sign out
    mockGetItemAsync.mockResolvedValueOnce('refresh-token');
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
});
