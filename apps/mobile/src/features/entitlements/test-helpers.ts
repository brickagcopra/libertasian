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
    }),
  );
}

/** Everything paid visible — an entitled account. */
export function setEntitled(): void {
  setFreemiumSurfaces({ scan: true, study: true, barExams: true });
}

/** Nothing paid visible — a free account. Also the default with no key set. */
export function setFreeTier(): void {
  storage.delete(STORAGE_KEYS.ENTITLED_SURFACES);
}
