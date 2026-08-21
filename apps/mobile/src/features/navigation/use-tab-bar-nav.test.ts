import { renderHook } from '@testing-library/react-native';
import { router } from 'expo-router';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

import { TAB_BAR_ROUTES, useTabBarNav } from './use-tab-bar-nav';

const mockedPush = router.push as jest.Mock;

describe('useTabBarNav', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // The bug this hook exists to prevent: the onPress switch used to be
  // copy-pasted into five screens, each handling a different subset of ids, so
  // which destinations were reachable depended on which screen you were on.
  it.each([
    ['home', '/(tabs)'],
    ['docs', '/documents'],
    ['search', '/(tabs)/search'],
    ['digests', '/(tabs)/digests'],
    ['study', '/(tabs)/study'],
    ['feed', '/(tabs)/feed'],
    ['workspace', '/(tabs)/workspace'],
    ['me', '/settings'],
  ] as const)('routes %s to %s', (id, route) => {
    const { result } = renderHook(() => useTabBarNav());

    result.current(id);

    expect(mockedPush).toHaveBeenCalledWith(route);
  });

  it('covers all eight ids with no gaps', () => {
    expect(Object.keys(TAB_BAR_ROUTES)).toHaveLength(8);
    for (const route of Object.values(TAB_BAR_ROUTES)) {
      expect(typeof route).toBe('string');
      // TAB_BAR_ROUTES is Record<TabBarItemId, Href> now, and Href also admits
      // the { pathname, params } object form — so narrow before asserting on
      // length rather than casting the union away.
      if (typeof route !== 'string') continue;
      expect(route.length).toBeGreaterThan(0);
    }
  });

  // Preserved deliberately: `docs` lands on /documents rather than
  // /(tabs)/library. That inconsistency predates this hook and changing it is a
  // product decision, not a navigation-plumbing one.
  it('keeps docs pointed at /documents, not /(tabs)/library', () => {
    expect(TAB_BAR_ROUTES.docs).toBe('/documents');
  });

  it('returns a stable handler across rerenders', () => {
    const { result, rerender } = renderHook(() => useTabBarNav());
    const first = result.current;
    rerender({});
    expect(result.current).toBe(first);
  });
});
