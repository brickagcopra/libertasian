import { storage, STORAGE_KEYS } from '../../storage/mmkv';
import type { FreemiumSurfaces } from './use-freemium-surfaces';

/**
 * Put the persisted entitlement answer into a known state for a test.
 *
 * `useFreemiumSurfaces()` reads MMKV synchronously, so a test that renders any
 * surface-gated component has to say which account it is standing in. Without a
 * call to this, the default is the free tier — which is correct behaviour, not
 * a missing mock.
 */
export function setFreemiumSurfaces(surfaces: Partial<FreemiumSurfaces>): void {
  storage.set(
    STORAGE_KEYS.ENTITLED_SURFACES,
    JSON.stringify({
      scan: surfaces.scan ?? false,
      study: surfaces.study ?? false,
      barExams: surfaces.barExams ?? false,
      digestGeneration: surfaces.digestGeneration ?? false,
      workspace: surfaces.workspace ?? false,
    }),
  );
}

/** Everything paid visible — an entitled account. */
export function setEntitled(): void {
  setFreemiumSurfaces({
    scan: true,
    study: true,
    barExams: true,
    digestGeneration: true,
    workspace: true,
  });
}

/** Nothing paid visible — a free account. Also the default with no key set. */
export function setFreeTier(): void {
  storage.delete(STORAGE_KEYS.ENTITLED_SURFACES);
}

/**
 * Set the D14 `storePurchaseAvailable` flag, which decides whether a purchase
 * entry point renders at all.
 *
 * Separate from {@link setFreemiumSurfaces} because it is an ORTHOGONAL axis:
 * "can this account see paid content" and "can this client buy anything" are
 * different questions, and the interesting test cases are the ones where they
 * disagree — a free account on a platform with a live store is exactly the
 * combination mechanism C exists for.
 *
 * Writes the whole blob, matching `useFreemiumSurfacesSync`, so a test never
 * ends up with a half-written key that the real parser would read differently.
 */
export function setSurfaceAccess(opts: {
  surfaces?: Partial<FreemiumSurfaces>;
  entitled?: boolean;
  storePurchaseAvailable?: boolean;
}): void {
  const s = opts.surfaces ?? {};
  storage.set(
    STORAGE_KEYS.ENTITLED_SURFACES,
    JSON.stringify({
      scan: s.scan ?? false,
      study: s.study ?? false,
      barExams: s.barExams ?? false,
      digestGeneration: s.digestGeneration ?? false,
      workspace: s.workspace ?? false,
      entitled: opts.entitled ?? false,
      storePurchaseAvailable: opts.storePurchaseAvailable ?? false,
    }),
  );
}
