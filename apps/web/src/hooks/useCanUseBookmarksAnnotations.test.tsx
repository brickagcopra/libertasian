import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockUserState: { user: { isPlatformAdmin?: boolean } | null } = {
  user: null,
};
const mockSubState: {
  data: { planCode: string; status: string } | null;
  isLoading: boolean;
  isError: boolean;
} = { data: null, isLoading: false, isError: false };

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (s: { user: { isPlatformAdmin?: boolean } | null }) => unknown,
  ) => selector({ user: mockUserState.user }),
}));

// Keep the real meetsMinimumTier — only stub the query hook.
vi.mock('@/features/billing/hooks/use-subscription', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/features/billing/hooks/use-subscription')
    >();
  return {
    ...actual,
    useSubscription: () => ({
      data: mockSubState.data,
      isLoading: mockSubState.isLoading,
      isError: mockSubState.isError,
    }),
  };
});

import { useCanUseBookmarksAnnotations } from './useCanUseBookmarksAnnotations';

beforeEach(() => {
  vi.clearAllMocks();
  mockUserState.user = null;
  mockSubState.data = null;
  mockSubState.isLoading = false;
  mockSubState.isError = false;
});

describe('useCanUseBookmarksAnnotations', () => {
  it('never locks platform admins, even with no subscription', () => {
    mockUserState.user = { isPlatformAdmin: true };
    mockSubState.data = null;

    const { result } = renderHook(() => useCanUseBookmarksAnnotations());

    expect(result.current).toEqual({ locked: false });
  });

  it('does not lock while the subscription query is loading (fail-open)', () => {
    mockUserState.user = {};
    mockSubState.isLoading = true;

    const { result } = renderHook(() => useCanUseBookmarksAnnotations());

    expect(result.current).toEqual({ locked: false });
  });

  it('does not lock when the subscription query errored (fail-open)', () => {
    mockUserState.user = {};
    mockSubState.isError = true;

    const { result } = renderHook(() => useCanUseBookmarksAnnotations());

    expect(result.current).toEqual({ locked: false });
  });

  it('locks users with no subscription record (resolved null / API 404)', () => {
    mockUserState.user = {};
    mockSubState.data = null;

    const { result } = renderHook(() => useCanUseBookmarksAnnotations());

    expect(result.current).toEqual({ locked: true });
  });

  it('locks active free plan users', () => {
    mockUserState.user = {};
    mockSubState.data = { planCode: 'free', status: 'active' };

    const { result } = renderHook(() => useCanUseBookmarksAnnotations());

    expect(result.current).toEqual({ locked: true });
  });

  it('does not lock active edu plan users', () => {
    mockUserState.user = {};
    mockSubState.data = { planCode: 'edu', status: 'active' };

    const { result } = renderHook(() => useCanUseBookmarksAnnotations());

    expect(result.current).toEqual({ locked: false });
  });

  it('does not lock trialing edu plan users', () => {
    mockUserState.user = {};
    mockSubState.data = { planCode: 'edu', status: 'trialing' };

    const { result } = renderHook(() => useCanUseBookmarksAnnotations());

    expect(result.current).toEqual({ locked: false });
  });

  it('does not lock plans above edu (pro, team, enterprise)', () => {
    mockUserState.user = {};
    for (const planCode of ['pro', 'team', 'enterprise']) {
      mockSubState.data = { planCode, status: 'active' };
      const { result } = renderHook(() => useCanUseBookmarksAnnotations());
      expect(result.current).toEqual({ locked: false });
    }
  });

  it('locks edu plan users with a non-active subscription', () => {
    mockUserState.user = {};
    mockSubState.data = { planCode: 'edu', status: 'past_due' };

    const { result } = renderHook(() => useCanUseBookmarksAnnotations());

    expect(result.current).toEqual({ locked: true });
  });
});
