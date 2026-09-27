import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PurchaseEntryPoint } from '@/features/purchase';
import { NOT_INCLUDED_MESSAGE } from '@/lib/api-client';

import { useSurfaceAccess, type FreemiumSurfaces } from './use-freemium-surfaces';

/** Where a hidden surface sends the user. Home is always reachable. */
const HOME = '/(tabs)' as const;

export interface SurfaceGuardProps {
  /** The surface this subtree belongs to. */
  surface: keyof FreemiumSurfaces;
  /**
   * Which blurb the purchase entry point shows, when it differs from the
   * surface. Deep Research rides the `workspace` visibility flag but is its own
   * feature, so it names itself rather than "Matters, notes, memos…".
   */
  entryPoint?: string;
  children: ReactNode;
}

/**
 * Decide what a guarded route renders. Three outcomes, in order.
 *
 * 1. NOT VISIBLE → `<Redirect>` home. Unchanged, and it is the ONLY outcome
 *    reachable while `storePurchaseAvailable` is false — i.e. on every
 *    deployment today, this component behaves exactly as it did before.
 *
 *    Hiding an entry point removes the way IN; it does not remove the route. A
 *    deep link, a push notification, a restored navigation state, or a
 *    `router.back()` into a screen that was reachable before a downgrade all
 *    land here without ever passing a tab or a button. `<Redirect>` rather than
 *    an effect: the guarded screen never mounts, so it fires no requests and
 *    paints no frame of paid UI before navigating away.
 *
 * 2. VISIBLE BUT NOT ENTITLED → the purchase entry point, IN PLACE OF the
 *    children. This is D14 option B, reached through mechanism C. The reasoning
 *    that made "always hide" correct was conditional on there being no way to
 *    buy; once there is one, showing the surface with a purchase entry point is
 *    the ordinary approvable pattern.
 *
 *    IN PLACE OF, not beside: every guarded screen in this app is written as
 *    `<SurfaceGuard><Content /></SurfaceGuard>`, with the queries inside
 *    `Content`. Substituting here means that subtree never mounts and fires no
 *    request the API would refuse — so data fetching is gated on ENTITLEMENT,
 *    not on the route having mounted. Threading an `enabled` flag through the
 *    ~15 feature hooks those screens call would gate the same requests in more
 *    places, each of which could be forgotten; this gates them in one, and the
 *    test asserts zero paid queries fire.
 *
 * 3. ENTITLED → the children, unchanged.
 *
 * Note that `useSurfaceAccess()` defaults to hidden-and-unentitled before the
 * first resolution. That is the right direction for both new branches: the last
 * answer is persisted, so it only bites on the very first launch after install,
 * and sending a brand-new user home is a smaller harm than showing them either
 * a refusal or a purchase entry point for a store that may not be live.
 */
export function SurfaceGuard({ surface, entryPoint, children }: SurfaceGuardProps) {
  const { surfaces, entitled } = useSurfaceAccess();

  if (!surfaces[surface]) {
    return <Redirect href={HOME} />;
  }

  if (!entitled) {
    return <PurchaseEntryPoint surface={entryPoint ?? surface} />;
  }

  return <>{children}</>;
}

export interface EntitlementRefusalProps {
  /** Which blurb the purchase entry point shows. */
  surface: string;
}

/**
 * The refusal for a METERED feature inside an entitled surface whose own limit
 * is 0 — or which the server refused with `subscription_required` anyway.
 *
 * Same two outcomes as the guard's second branch, and lives here for the same
 * reason: this file is one of the reviewed doors into the purchase surface
 * (`PERMITTED_PURCHASE_ENTRY_POINTS`), so a feature that needs the purchase
 * entry point asks for it through this component instead of opening a new door.
 *
 *   - store purchase live on THIS platform → the purchase entry point;
 *   - otherwise → the fixed neutral refusal. It names no tier, no price and no
 *     other place to pay: pointing at an off-app purchase is the steering that
 *     3.1.1 / 3.1.3 and Play's payments policy reject, so there is no "do it on
 *     the web" line here, on any platform.
 */
export function EntitlementRefusal({ surface }: EntitlementRefusalProps) {
  const { storePurchaseAvailable } = useSurfaceAccess();

  if (storePurchaseAvailable) {
    return <PurchaseEntryPoint surface={surface} />;
  }

  return (
    <View style={styles.refusal} testID="entitlement-refusal">
      <Text style={styles.refusalText}>{NOT_INCLUDED_MESSAGE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  refusal: { padding: 24, alignItems: 'center', justifyContent: 'center' },
  refusalText: { fontSize: 15, lineHeight: 22, color: '#5C5448', textAlign: 'center' },
});
