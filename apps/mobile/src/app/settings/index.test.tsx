import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock dependencies
const mockSignOut = jest.fn();
const mockAuthUser = {
  id: 'u1',
  fullName: 'Juan Cruz',
  email: 'juan@libertasian.com',
  emailVerified: true,
  mfaEnabled: false,
  organizationRole: 'admin' as const,
  organizationId: 'org1',
  userRole: null,
  createdAt: '2024-01-15T00:00:00Z',
};
jest.mock('../../providers/auth-provider', () => ({
  useAuth: () => ({
    user: mockAuthUser,
    signIn: jest.fn(),
    signOut: mockSignOut,
    isAuthenticated: true,
    isLoading: false,
    setUser: jest.fn(),
  }),
}));

const mockUseProfile = jest.fn();
jest.mock('../../features/auth/hooks/use-auth', () => ({
  useProfile: () => mockUseProfile(),
}));

jest.mock('../../lib/constants', () => ({
  APP_NAME: 'LIBERTASIAN',
}));

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

import { router } from 'expo-router';
import SettingsScreen from './index';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseProfile.mockReturnValue({
      data: null,
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
  });

  it('renders profile information', () => {
    const { getByText, queryByText } = render(<SettingsScreen />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Profile')).toBeTruthy();
    expect(getByText('Juan Cruz')).toBeTruthy();
    expect(getByText('juan@libertasian.com')).toBeTruthy();
    expect(queryByText('JC')).toBeTruthy(); // Avatar initials
  });

  it('shows email verification status', () => {
    const { getByText } = render(<SettingsScreen />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Email Verified')).toBeTruthy();
    expect(getByText('Verified')).toBeTruthy();
  });

  it('shows MFA status', () => {
    const { getByText } = render(<SettingsScreen />, {
      wrapper: createWrapper(),
    });

    expect(getByText('MFA')).toBeTruthy();
    expect(getByText('Disabled')).toBeTruthy();
  });

  it('shows member since date', () => {
    const { getByText } = render(<SettingsScreen />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Member Since')).toBeTruthy();
    // Date may render as Jan 14 or 15 depending on timezone offset
    expect(getByText(/January 1[45], 2024/)).toBeTruthy();
  });

  it('renders Admin Dashboard link', () => {
    const { getByText } = render(<SettingsScreen />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Admin Dashboard')).toBeTruthy();

    fireEvent.press(getByText('Admin Dashboard'));
    expect(router.push).toHaveBeenCalledWith('/admin');
  });

  it('renders API Keys link', () => {
    const { getByText } = render(<SettingsScreen />, {
      wrapper: createWrapper(),
    });

    expect(getByText('API Keys')).toBeTruthy();

    fireEvent.press(getByText('API Keys'));
    expect(router.push).toHaveBeenCalledWith('/settings/api-keys');
  });

  it('hides Admin Dashboard for non-admin roles', () => {
    // Temporarily override the mock user's role
    const originalRole = mockAuthUser.organizationRole;
    (mockAuthUser as Record<string, unknown>).organizationRole = 'member';

    const { queryByText } = render(<SettingsScreen />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('Admin Dashboard')).toBeNull();

    // Restore
    (mockAuthUser as Record<string, unknown>).organizationRole = originalRole;
  });

  it('renders About section with app info', () => {
    const { getByText } = render(<SettingsScreen />, {
      wrapper: createWrapper(),
    });

    expect(getByText('About')).toBeTruthy();
    expect(getByText('LIBERTASIAN')).toBeTruthy();
    expect(getByText('1.0.0')).toBeTruthy();
  });

  it('shows sign out confirmation dialog', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');

    const { getByText } = render(<SettingsScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('Sign Out'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Sign Out',
      'Are you sure you want to sign out?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel' }),
        expect.objectContaining({ text: 'Sign Out', style: 'destructive' }),
      ]),
    );
  });

  it('calls signOut when confirmation is accepted', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');

    const { getByText } = render(<SettingsScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('Sign Out'));

    // Get the onPress handler from the destructive button
    const buttons = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const signOutButton = buttons.find((b) => b.text === 'Sign Out');
    signOutButton?.onPress?.();

    expect(mockSignOut).toHaveBeenCalled();
  });
});
