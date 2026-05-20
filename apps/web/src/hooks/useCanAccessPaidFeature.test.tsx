import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useCanAccessPaidFeature } from './useCanAccessPaidFeature';

// IMPORTANT: this test file deliberately does NOT rely on the global
// `useCanAccessPaidFeature` setup mock — we test the hook itself. We mock
// its inputs (`useAuthStore`, `useSubscription`) and unmock the hook
// module so we exercise the real implementation.
vi.unmock('@/hooks/useCanAccessPaidFeature');

const mockUserState: { user: { isPlatformAdmin?: boolean } | null } = { user: null };
const mockSubState: {
  data: { planCode: string; status: string } | null;
  isLoading: boolean;
} = { data: null, isLoading: false };

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (s: { user: { isPlatformAdmin?: boolean } | null }) => unknown,
  ) => selector({ user: mockUserState.user }),
}));

vi.mock('@/features/billing/hooks/use-subscription', () => ({
  useSubscription: () => ({
    data: mockSubState.data,
    isLoading: mockSubState.isLoading,
  }),
}));

beforeEach(() => {
  mockUserState.user = null;
  mockSubState.data = null;
  mockSubState.isLoading = false;
});

describe('useCanAccessPaidFeature', () => {
  it('returns admin bypass when user.isPlatformAdmin is true (even on free plan)', () => {
    mockUserState.user = { isPlatformAdmin: true };
    mockSubState.data = { planCode: 'free', status: 'active' };

    const { result } = renderHook(() => useCanAccessPaidFeature());

    expect(result.current).toEqual({ canAccess: true, reason: 'admin' });
  });

  it('returns admin bypass even while subscription query is still loading', () => {
    // The admin short-circuit runs BEFORE the loading check so the UI does
    // not flash a paywall during the initial subscription fetch.
    mockUserState.user = { isPlatformAdmin: true };
    mockSubState.isLoading = true;

    const { result } = renderHook(() => useCanAccessPaidFeature());

    expect(result.current).toEqual({ canAccess: true, reason: 'admin' });
  });

  it('returns loading when non-admin and subscription is still fetching', () => {
    mockUserState.user = { isPlatformAdmin: false };
    mockSubState.isLoading = true;

    const { result } = renderHook(() => useCanAccessPaidFeature());

    expect(result.current).toEqual({ canAccess: false, reason: 'loading' });
  });

  it('returns paid for an active non-free subscription', () => {
    mockUserState.user = { isPlatformAdmin: false };
    mockSubState.data = { planCode: 'pro', status: 'active' };

    const { result } = renderHook(() => useCanAccessPaidFeature());

    expect(result.current).toEqual({ canAccess: true, reason: 'paid' });
  });

  it('returns paid for a trialing non-free subscription', () => {
    mockUserState.user = { isPlatformAdmin: false };
    mockSubState.data = { planCode: 'pro', status: 'trialing' };

    const { result } = renderHook(() => useCanAccessPaidFeature());

    expect(result.current).toEqual({ canAccess: true, reason: 'paid' });
  });

  it('returns free when planCode is free', () => {
    mockUserState.user = { isPlatformAdmin: false };
    mockSubState.data = { planCode: 'free', status: 'active' };

    const { result } = renderHook(() => useCanAccessPaidFeature());

    expect(result.current).toEqual({ canAccess: false, reason: 'free' });
  });

  it('returns free for a canceled non-free plan', () => {
    mockUserState.user = { isPlatformAdmin: false };
    mockSubState.data = { planCode: 'pro', status: 'canceled' };

    const { result } = renderHook(() => useCanAccessPaidFeature());

    expect(result.current).toEqual({ canAccess: false, reason: 'free' });
  });

  it('returns free when subscription is null (no active subscription)', () => {
    mockUserState.user = { isPlatformAdmin: false };
    mockSubState.data = null;

    const { result } = renderHook(() => useCanAccessPaidFeature());

    expect(result.current).toEqual({ canAccess: false, reason: 'free' });
  });

  it('treats missing isPlatformAdmin (older cached state) as non-admin (fail-closed)', () => {
    // If localStorage was populated before the field existed, the user
    // object may lack isPlatformAdmin entirely. We must NOT grant admin
    // bypass — the next /users/me call will refresh the trust signal.
    mockUserState.user = {};
    mockSubState.data = { planCode: 'free', status: 'active' };

    const { result } = renderHook(() => useCanAccessPaidFeature());

    expect(result.current).toEqual({ canAccess: false, reason: 'free' });
  });

  it('treats unauthenticated state as non-admin', () => {
    mockUserState.user = null;
    mockSubState.data = null;

    const { result } = renderHook(() => useCanAccessPaidFeature());

    expect(result.current).toEqual({ canAccess: false, reason: 'free' });
  });
});
