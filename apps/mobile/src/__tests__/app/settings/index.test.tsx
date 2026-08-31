import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
jest.mock('@/providers/auth-provider', () => ({
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
jest.mock('@/features/auth/hooks/use-auth', () => ({
  useProfile: () => mockUseProfile(),
}));

import { router } from 'expo-router';
import SettingsRoute from '@/app/settings/index';
import {
  setEntitled,
  setFreeTier,
  setSurfaceAccess,
} from '@/features/entitlements/test-helpers';

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

describe('SettingsRoute (Phase 2 ProfileScreen)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseProfile.mockReturnValue({
      data: null,
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    (mockAuthUser as Record<string, unknown>).organizationRole = 'admin';
    (mockAuthUser as Record<string, unknown>).emailVerified = true;
    (mockAuthUser as Record<string, unknown>).mfaEnabled = false;
  });

  it('renders profile identity (name, email, initials)', () => {
    const { getByText } = render(<SettingsRoute />, { wrapper: createWrapper() });

    expect(getByText('Juan Cruz')).toBeTruthy();
    expect(getByText('juan@libertasian.com')).toBeTruthy();
    expect(getByText('JC')).toBeTruthy();
  });

  it('renders verified / MFA / member-since stats', () => {
    const { getByText } = render(<SettingsRoute />, { wrapper: createWrapper() });

    expect(getByText('Yes')).toBeTruthy();
    expect(getByText('Verified')).toBeTruthy();
    expect(getByText('Off')).toBeTruthy();
    expect(getByText('MFA')).toBeTruthy();
    expect(getByText('Member')).toBeTruthy();
    expect(getByText(/Jan 2024/)).toBeTruthy();
  });

  it('renders the Admin dashboard row for admin users', () => {
    const { getByText } = render(<SettingsRoute />, { wrapper: createWrapper() });
    expect(getByText('Admin dashboard')).toBeTruthy();

    fireEvent.press(getByText('Admin dashboard'));
    expect(router.push).toHaveBeenCalledWith('/admin');
  });

  it('hides the Admin dashboard row for non-admin users', () => {
    (mockAuthUser as Record<string, unknown>).organizationRole = 'member';
    const { queryByText } = render(<SettingsRoute />, { wrapper: createWrapper() });
    expect(queryByText('Admin dashboard')).toBeNull();
  });

  it('renders the Security row and routes to /settings/security', () => {
    const { getByText } = render(<SettingsRoute />, { wrapper: createWrapper() });

    expect(getByText('Security')).toBeTruthy();

    fireEvent.press(getByText('Security'));
    expect(router.push).toHaveBeenCalledWith('/settings/security');
  });

  // Inverted deliberately. API keys are an enterprise-gated developer surface
  // the API leaves closed, so the row was the one settings entry that would
  // still 403 with tier wording. The screen is gone from mobile 1.0.
  it('renders no API keys row', () => {
    const { queryByText } = render(<SettingsRoute />, { wrapper: createWrapper() });

    expect(queryByText('API keys')).toBeNull();
  });

  // getAllByText, not getByText: the floating pill TabBar now carries its own
  // "Digests", "Study" and "Feed" labels, so each of those strings legitimately
  // appears twice on this screen. "Workspace" stays unique — the bar's slot is
  // labelled "Work" so eight items fit a 375pt screen.
  it('renders drawer-replacement quick links (Phase 2 IA)', () => {
    setEntitled();
    const { getAllByText, getByText } = render(<SettingsRoute />, {
      wrapper: createWrapper(),
    });

    expect(getAllByText('Digests').length).toBeGreaterThan(0);
    expect(getAllByText('Study').length).toBeGreaterThan(0);
    expect(getAllByText('Feed').length).toBeGreaterThan(0);
    expect(getByText('Workspace')).toBeTruthy();
  });

  // This profile surface is the Study tab's OTHER entry point. Filtering the
  // TabBar alone would leave a row here that taps straight into a refusal.
  it('drops the Study quick link for a free account, keeping the rest', () => {
    setFreeTier();
    const { queryByText, getAllByText, getByText } = render(<SettingsRoute />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('Study')).toBeNull();
    expect(getAllByText('Digests').length).toBeGreaterThan(0);
    expect(getAllByText('Feed').length).toBeGreaterThan(0);
    expect(getByText('Workspace')).toBeTruthy();
  });

  it('shows the sign-out confirmation dialog', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');

    const { getByText } = render(<SettingsRoute />, { wrapper: createWrapper() });

    fireEvent.press(getByText('Sign out'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Sign out',
      'Are you sure you want to sign out?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel' }),
        expect.objectContaining({ text: 'Sign out', style: 'destructive' }),
      ]),
    );
  });

  it('calls signOut when confirmation is accepted', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');

    const { getByText } = render(<SettingsRoute />, { wrapper: createWrapper() });

    fireEvent.press(getByText('Sign out'));

    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    const confirmButton = buttons.find((b) => b.text === 'Sign out' && b !== buttons[0]);
    confirmButton?.onPress?.();

    expect(mockSignOut).toHaveBeenCalled();
  });

  // ---- the purchase door (D14 mechanism C) ----

  describe('the purchase row is gated on storePurchaseAvailable', () => {
    /**
     * "Manage account access" is the ONLY door into the purchase surface, and
     * `no-purchase-copy.test.ts` pins this file as the one permitted importer.
     * Before build 26 the row rendered unconditionally, which put a door to a
     * purchase screen on every platform — including the ones with no live
     * store, where tapping it leads to products that cannot be bought.
     *
     * The flag is the server's per-platform answer, so these two cases are the
     * whole contract.
     */

    it('hides the purchase row when storePurchaseAvailable is false', () => {
      setSurfaceAccess({ storePurchaseAvailable: false });

      const { queryByText } = render(<SettingsRoute />, { wrapper: createWrapper() });

      // REMOVED, not merely disabled: a visible-but-dead row is the same
      // shown-and-refused pattern with an extra tap in front of it.
      expect(queryByText('Manage account access')).toBeNull();
    });

    it('shows the purchase row when storePurchaseAvailable is true', () => {
      setSurfaceAccess({ storePurchaseAvailable: true });

      const { getByText } = render(<SettingsRoute />, { wrapper: createWrapper() });

      expect(getByText('Manage account access')).toBeTruthy();
    });

    it('keeps Usage & quotas visible either way', () => {
      // Usage applies to every account and names nothing purchasable, so it
      // must not be swept up by the gate.
      setSurfaceAccess({ storePurchaseAvailable: false });
      const free = render(<SettingsRoute />, { wrapper: createWrapper() });
      expect(free.getByText('Usage & quotas')).toBeTruthy();
      free.unmount();

      setSurfaceAccess({ storePurchaseAvailable: true });
      const purchasable = render(<SettingsRoute />, { wrapper: createWrapper() });
      expect(purchasable.getByText('Usage & quotas')).toBeTruthy();
    });

    it('shows the purchase row for an ENTITLED account on a purchasable platform', () => {
      // Entitlement and purchasability are orthogonal: a subscriber still needs
      // the door to manage or restore. Gating on `entitled` instead would hide
      // it from exactly the people most likely to want it.
      setSurfaceAccess({
        surfaces: { scan: true, study: true, barExams: true, digestGeneration: true, workspace: true },
        entitled: true,
        storePurchaseAvailable: true,
      });

      const { getByText } = render(<SettingsRoute />, { wrapper: createWrapper() });

      expect(getByText('Manage account access')).toBeTruthy();
    });

    it('routes to the purchase surface when the row is pressed', () => {
      setSurfaceAccess({ storePurchaseAvailable: true });

      const { getByText } = render(<SettingsRoute />, { wrapper: createWrapper() });
      fireEvent.press(getByText('Manage account access'));

      expect(router.push).toHaveBeenCalledWith('/purchase');
    });
  });
});
