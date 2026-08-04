import { useCallback } from 'react';
import { router } from 'expo-router';

import type { TabBarItemId } from '@/components/ui/TabBar';

/**
 * The one place a TabBar id becomes a route.
 *
 * This switch used to be copy-pasted into five screens ((tabs)/index,
 * (tabs)/digests, (tabs)/search, documents/index, settings/index), and each copy
 * handled a different subset of ids — so which destinations were reachable
 * depended on which screen you happened to be standing on. With eight items in
 * the bar that stops being a tidiness problem and becomes dead buttons.
 */
export const TAB_BAR_ROUTES: Record<TabBarItemId, string> = {
  home: '/(tabs)',
  // Deliberately `/documents`, NOT `/(tabs)/library`. That inconsistency
  // predates this hook; it is preserved verbatim rather than "fixed" here,
  // because changing where the Library tab lands is a product decision and this
  // is a navigation-plumbing change.
  docs: '/documents',
  search: '/(tabs)/search',
  digests: '/(tabs)/digests',
  study: '/(tabs)/study',
  feed: '/(tabs)/feed',
  workspace: '/(tabs)/workspace',
  me: '/settings',
};

/**
 * Returns the TabBar `onPress` handler. Every screen that renders a TabBar uses
 * this, so all eight destinations are reachable from all of them.
 */
export function useTabBarNav() {
  return useCallback((id: TabBarItemId) => {
    const route = TAB_BAR_ROUTES[id];
    if (route) router.push(route as never);
  }, []);
}
