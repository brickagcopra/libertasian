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

const mockUseHomeFeed = jest.fn();
jest.mock('@/features/home/hooks/use-home-feed', () => ({
  useHomeFeed: () => mockUseHomeFeed(),
}));

import { router } from 'expo-router';
import HomeRoute from '@/app/(tabs)/index';

const seededFeed = {
  todaysBrief: [
    {
      id: 'brief-1',
      kind: 'digest' as const,
      category: 'CASE DIGEST',
      headline: 'Briefed: People v. Santos',
      minutes: 4,
    },
  ],
  forYou: [
    {
      id: 'digest-1',
      kind: 'digest' as const,
      category: 'CASE DIGEST',
      headline: 'Digest of Agabon v. NLRC',
      minutes: 3,
    },
    {
      id: 'doc-article-1',
      kind: 'document' as const,
      category: 'ARTICLE',
      headline: 'Right to be Forgotten',
      minutes: 6,
      byline: 'LIBERTASIAN Editorial',
    },
  ],
  nextCursor: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseHomeFeed.mockReturnValue({
    data: seededFeed,
    isLoading: false,
    isError: false,
  });
});

describe('HomeRoute', () => {
  it('renders the redesigned home greeting with the user first name', () => {
    const { getByText } = render(<HomeRoute />);
    expect(getByText(/^Hi, Juan\./)).toBeTruthy();
  });

  it('falls back to a generic greeting when no user is loaded', () => {
    (mockAuthUser as Record<string, unknown>).fullName = '';
    const { getByText } = render(<HomeRoute />);
    expect(getByText(/^Welcome back\./)).toBeTruthy();
    (mockAuthUser as Record<string, unknown>).fullName = 'Juan Cruz';
  });

  it("renders today's brief headline from the API response", () => {
    const { getByText } = render(<HomeRoute />);
    expect(getByText('Briefed: People v. Santos')).toBeTruthy();
    // Eyebrow is built from the brief item's minutes — verify wiring.
    expect(getByText("Today's brief · 4 min")).toBeTruthy();
  });

  it('routes a digest feed item to /digest/:id', () => {
    const { getByText } = render(<HomeRoute />);
    fireEvent.press(getByText('Digest of Agabon v. NLRC'));
    expect(router.push).toHaveBeenCalledWith('/digest/digest-1');
  });

  it('routes a document feed item to /reader/:id (kind discriminator)', () => {
    const { getByText } = render(<HomeRoute />);
    fireEvent.press(getByText('Right to be Forgotten'));
    expect(router.push).toHaveBeenCalledWith('/reader/doc-article-1');
  });

  it('routes "See all" to the digests tab', () => {
    const { getByText } = render(<HomeRoute />);
    fireEvent.press(getByText('See all'));
    expect(router.push).toHaveBeenCalledWith('/(tabs)/digests');
  });

  it('routes the brief CTA to the brief item route', () => {
    // Brief item is a digest in our fixture, so the CTA must route to /digest/:id.
    const { getByText } = render(<HomeRoute />);
    fireEvent.press(getByText('Read brief →'));
    expect(router.push).toHaveBeenCalledWith('/digest/brief-1');
  });

  it('renders a loading indicator while the feed is in flight', () => {
    mockUseHomeFeed.mockReturnValueOnce({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    const { UNSAFE_getByType } = render(<HomeRoute />);
    // ActivityIndicator from react-native is used during loading
    const ActivityIndicator = require('react-native').ActivityIndicator;
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });

  it('renders the screen with an empty feed when the API errors out', () => {
    mockUseHomeFeed.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    const { getByText, queryByText } = render(<HomeRoute />);
    // Greeting still mounts (the screen stays usable on error).
    expect(getByText(/^Hi, Juan\./)).toBeTruthy();
    // No fixture items leak in — the API-only seam is tight.
    expect(queryByText('Right to be Forgotten')).toBeNull();
  });
});
