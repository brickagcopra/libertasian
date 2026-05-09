import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

const mockAuthUser = {
  id: 'u1',
  fullName: 'Juan Cruz',
  email: 'juan@libertasian.com',
  emailVerified: true,
  mfaEnabled: false,
  organizationRole: 'member' as const,
  organizationId: 'org1',
  userRole: null,
  createdAt: '2024-01-15T00:00:00Z',
};

jest.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({
    user: mockAuthUser,
    signIn: jest.fn(),
    signOut: jest.fn(),
    isAuthenticated: true,
    isLoading: false,
    setUser: jest.fn(),
  }),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

import { router } from 'expo-router';
import HomeRoute from '@/app/(tabs)/index';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('HomeRoute (Phase 3 HomeScreen)', () => {
  it('renders the redesigned home greeting with the user first name', () => {
    const { getByText } = render(<HomeRoute />);
    // Greeting renders as "<name> <follow-up>" with the follow-up nested in
    // a sibling Text — match by regex on the prefix.
    expect(getByText(/^Hi, Juan\./)).toBeTruthy();
  });

  it('falls back to a generic greeting when no user is loaded', () => {
    (mockAuthUser as Record<string, unknown>).fullName = '';
    const { getByText } = render(<HomeRoute />);
    expect(getByText(/^Welcome back\./)).toBeTruthy();
    (mockAuthUser as Record<string, unknown>).fullName = 'Juan Cruz';
  });

  it("renders today's brief default copy", () => {
    const { getByText } = render(<HomeRoute />);
    // Default brief from HomeScreen
    expect(getByText('When does a tweet become a contract?')).toBeTruthy();
  });

  it('routes to /digest/:id when a feed item is pressed', () => {
    const { getByText } = render(<HomeRoute />);
    // First default feed item headline
    fireEvent.press(getByText("The promise that wasn't: a guide to consideration"));
    expect(router.push).toHaveBeenCalledWith('/digest/a');
  });
});
