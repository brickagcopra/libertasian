import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';

import { PurchaseEntryPoint } from '@/features/purchase';

import { useSurfaceAccess, type FreemiumSurfaces } from './use-freemium-surfaces';

/** Where a hidden surface sends the user. Home is always reachable. */
const HOME = '/(tabs)' as const;

export interface SurfaceGuardProps {
  /** The surface this subtree belongs to. */
  surface: keyof FreemiumSurfaces;
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
export function SurfaceGuard({ surface, children }: SurfaceGuardProps) {
  const { surfaces, entitled } = useSurfaceAccess();

  if (!surfaces[surface]) {
    return <Redirect href={HOME} />;
  }

  if (!entitled) {
    return <PurchaseEntryPoint surface={surface} />;
  }

  return <>{children}</>;
}
