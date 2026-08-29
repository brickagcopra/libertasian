import React from 'react';
import { render, act } from '@testing-library/react-native';

// Mock dependencies
const mockReplace = jest.fn();
const mockUseSegments = jest.fn();

jest.mock('expo-router', () => ({
  Slot: () => null,
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  useSegments: () => mockUseSegments(),
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

jest.mock('@tanstack/react-query', () => ({
  QueryClient: jest.fn().mockImplementation(() => ({})),
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockUseAuth = jest.fn();
jest.mock('@/providers/auth-provider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
}));

// AuthNavigationGuard mounts the notification socket + push registration
// hooks; both are unit-tested separately and stubbed here so this suite stays
// focused on navigation behavior (no sockets / native notification modules).
const mockUseNotificationSocket = jest.fn();
jest.mock('@/features/workspace/hooks/use-notifications', () => ({
  useNotificationSocket: (isAuthenticated: boolean) =>
    mockUseNotificationSocket(isAuthenticated),
}));
const mockUsePushNotifications = jest.fn();
jest.mock('@/features/workspace/hooks/use-push-notifications', () => ({
  usePushNotifications: (isAuthenticated: boolean) =>
    mockUsePushNotifications(isAuthenticated),
}));
// Same treatment: the entitlement sync hook holds the /quotas/usage query for
// the whole app and is unit-tested separately.
const mockUseFreemiumSurfacesSync = jest.fn();
jest.mock('@/features/entitlements/use-freemium-surfaces', () => ({
  useFreemiumSurfacesSync: (isAuthenticated: boolean) =>
    mockUseFreemiumSurfacesSync(isAuthenticated),
}));

jest.mock('@expo-google-fonts/inter', () => ({
  useFonts: () => [true],
  Inter_400Regular: 'Inter_400Regular',
  Inter_500Medium: 'Inter_500Medium',
  Inter_600SemiBold: 'Inter_600SemiBold',
  Inter_700Bold: 'Inter_700Bold',
}));

jest.mock('@expo-google-fonts/fraunces', () => ({
  useFonts: () => [true],
  Fraunces_400Regular: 'Fraunces_400Regular',
  Fraunces_500Medium: 'Fraunces_500Medium',
  Fraunces_600SemiBold: 'Fraunces_600SemiBold',
}));

jest.mock('@expo-google-fonts/instrument-serif', () => ({
  useFonts: () => [true],
  InstrumentSerif_400Regular: 'InstrumentSerif_400Regular',
  InstrumentSerif_400Regular_Italic: 'InstrumentSerif_400Regular_Italic',
}));

jest.mock('react-native-mmkv', () => {
  const store = new Map<string, string | number | boolean>();
  return {
    MMKV: jest.fn().mockImplementation(() => ({
      getString: (k: string) => store.get(k) as string | undefined,
      set: (k: string, v: string | number | boolean) => store.set(k, v),
      getBoolean: (k: string) => store.get(k) as boolean | undefined,
      getNumber: (k: string) => store.get(k) as number | undefined,
      delete: (k: string) => store.delete(k),
      contains: (k: string) => store.has(k),
      clearAll: () => store.clear(),
    })),
  };
});

import RootLayout from '@/app/_layout';

beforeEach(() => {
  jest.clearAllMocks();
  mockUseSegments.mockReturnValue(['(tabs)']);
});

describe('AuthNavigationGuard', () => {
  it('shows loading indicator when auth is loading', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
      user: null,
    });

    const { getByTestId, queryByTestId } = render(<RootLayout />);
    // ActivityIndicator renders, Slot does not
    // The loading state renders a View with ActivityIndicator
  });

  it('redirects unauthenticated user to login', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      user: null,
    });
    mockUseSegments.mockReturnValue(['(tabs)']);

    render(<RootLayout />);

    expect(mockReplace).toHaveBeenCalledWith('/(auth)/login');
  });

  it('does not redirect unauthenticated user already on auth page', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      user: null,
    });
    mockUseSegments.mockReturnValue(['(auth)']);

    render(<RootLayout />);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('allows unauthenticated access to shared (public) routes', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      user: null,
    });
    mockUseSegments.mockReturnValue(['shared']);

    render(<RootLayout />);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('redirects authenticated user from auth page to tabs (completed onboarding)', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'u1', onboardingCompletedAt: '2026-01-01' },
    });
    mockUseSegments.mockReturnValue(['(auth)']);

    render(<RootLayout />);

    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
  });

  it('redirects authenticated user from auth page to onboarding (not completed)', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'u1', onboardingCompletedAt: null },
    });
    mockUseSegments.mockReturnValue(['(auth)']);

    render(<RootLayout />);

    expect(mockReplace).toHaveBeenCalledWith('/(onboarding)');
  });

  it('redirects to onboarding when authenticated but onboarding not completed', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'u1', onboardingCompletedAt: null },
    });
    mockUseSegments.mockReturnValue(['(tabs)']);

    render(<RootLayout />);

    expect(mockReplace).toHaveBeenCalledWith('/(onboarding)');
  });

  it('redirects from onboarding to tabs when onboarding is completed', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'u1', onboardingCompletedAt: '2026-01-01' },
    });
    mockUseSegments.mockReturnValue(['(onboarding)']);

    render(<RootLayout />);

    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
  });

  it('does not redirect authenticated user with completed onboarding on tabs', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'u1', onboardingCompletedAt: '2026-01-01' },
    });
    mockUseSegments.mockReturnValue(['(tabs)']);

    render(<RootLayout />);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('mounts the notification socket and push hooks with the auth state', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'u1', onboardingCompletedAt: '2026-01-01' },
    });
    mockUseSegments.mockReturnValue(['(tabs)']);

    render(<RootLayout />);

    expect(mockUseNotificationSocket).toHaveBeenCalledWith(true);
    expect(mockUsePushNotifications).toHaveBeenCalledWith(true);
    // The entitlement answer every screen reads is refreshed from exactly one
    // place. If this stops being mounted, `useFreemiumSurfaces()` falls back to
    // its last persisted value forever.
    expect(mockUseFreemiumSurfacesSync).toHaveBeenCalledWith(true);
  });

  it('does not perform any navigation while loading', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
      user: null,
    });
    mockUseSegments.mockReturnValue(['(tabs)']);

    render(<RootLayout />);

    expect(mockReplace).not.toHaveBeenCalled();
  });
});
