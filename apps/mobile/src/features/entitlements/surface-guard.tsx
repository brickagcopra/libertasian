import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';

import { useFreemiumSurfaces, type FreemiumSurfaces } from './use-freemium-surfaces';

/** Where a hidden surface sends the user. Home is always reachable. */
const HOME = '/(tabs)' as const;

export interface SurfaceGuardProps {
  /** The surface this subtree belongs to. */
  surface: keyof FreemiumSurfaces;
  children: ReactNode;
}

/**
 * Send the user home instead of rendering a surface their account cannot use.
 *
 * Hiding an entry point removes the way IN; it does not remove the route.
 * A deep link, a push notification, a restored navigation state, or a
 * `router.back()` into a screen that was reachable before a downgrade all land
 * here without ever passing a tab or a button. The API still gates the data
 * either way — this is not about access, it is about never PRESENTING a
 * refusal. A screen that loads and then shows "not available" is the
 * shown-and-refused pattern App Store 3.1.1 rejects, whichever door it was
 * reached through.
 *
 * `<Redirect>` rather than an effect: the guarded screen never mounts, so it
 * fires no requests and paints no frame of paid UI before navigating away.
 *
 * Note that `useFreemiumSurfaces()` defaults to hidden before the first
 * resolution. That is the right direction here too — the last answer is
 * persisted, so this only bites on the very first launch after install, and
 * sending a brand-new user home is a smaller harm than showing them a refusal.
 */
export function SurfaceGuard({ surface, children }: SurfaceGuardProps) {
  const surfaces = useFreemiumSurfaces();

  if (!surfaces[surface]) {
    return <Redirect href={HOME} />;
  }

  return <>{children}</>;
}
