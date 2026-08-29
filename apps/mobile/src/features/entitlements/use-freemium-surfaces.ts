import { useEffect } from 'react';
import { useMMKVString } from 'react-native-mmkv';

import { useQuotaUsage } from '../billing/hooks/use-quotas';
import { storage, STORAGE_KEYS } from '../../storage/mmkv';

/**
 * Which paid surfaces this account can reach.
 *
 * `false` means the surface is REMOVED from the UI — no row, no tab, no button.
 * A hidden feature renders nothing at all: no plan name, no price, no upgrade
 * prompt, no website. `lib/api-client.ts` NOT_INCLUDED_MESSAGE and
 * `features/derivatives/renderers/gated-notice.tsx` carry the wording for the
 * paths that can still surface a refusal; nothing here adds to it.
 */
export interface FreemiumSurfaces {
  /** Camera scan → digest. */
  scan: boolean;
  /** Study: bar subjects, flashcards, reviewer packs, sessions, syllabus. */
  study: boolean;
  /** Past bar exam questions. */
  barExams: boolean;
}

/** Everything visible. What an entitled account resolves to. */
const ALL_VISIBLE: FreemiumSurfaces = { scan: true, study: true, barExams: true };

/**
 * Nothing paid visible. What a free account resolves to, and also the
 * pre-resolution default — see {@link useFreemiumSurfaces}.
 */
const FREE_TIER: FreemiumSurfaces = { scan: false, study: false, barExams: false };

/**
 * The API is the only authority on what an account can reach.
 *
 * This deliberately does NOT compare a plan code. `meetsMinimumTier()` and
 * `useCanGenerateDigest()` used to live in
 * `features/billing/hooks/use-subscription.ts` and did exactly that; both were
 * deleted because a client-side copy of an entitlement decision kept screens
 * locked after the API had stopped locking them. The signal here is the
 * SERVER's own resolved answer: `/quotas/usage` limits come from
 * `resolveEffectiveEntitlements`, so an admin override or a promotional bonus
 * raises the limit and the surface comes back with no client change.
 *
 * `cameraScansPerMonth` and `digestsPerMonth` are both 0 on the free tier and
 * positive (or -1, unlimited) on every paid one, which is what makes the pair a
 * faithful reading of "non-entitled". A first-class `previewOnly` field on
 * `/quotas/usage` would say it directly and is worth adding; until then this is
 * the resolved entitlement rather than a guess about a tier.
 */
export function surfacesFromQuotas(
  quotas: Record<string, { limit: number }>,
): FreemiumSurfaces {
  const limitOf = (key: string): number => quotas[key]?.limit ?? 0;
  const entitled =
    limitOf('cameraScansPerMonth') !== 0 || limitOf('digestsPerMonth') !== 0;
  return entitled ? ALL_VISIBLE : FREE_TIER;
}

function parse(raw: string | undefined): FreemiumSurfaces | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<FreemiumSurfaces>;
    return {
      scan: parsed.scan === true,
      study: parsed.study === true,
      barExams: parsed.barExams === true,
    };
  } catch {
    // A corrupt value is a cache miss, never a crash on launch.
    return null;
  }
}

/**
 * Resolve which paid surfaces to render. Synchronous, and reachable from a
 * `components/ui` primitive.
 *
 * Deliberately reads MMKV rather than running the query itself. `TabBar` is a
 * presentational component rendered on seventeen screens; making it require a
 * QueryClientProvider would put a data dependency into `components/ui` and make
 * every one of those screens' tests set up a provider to render a tab bar.
 * `useMMKVString` is reactive, so the bar still updates the moment
 * {@link useFreemiumSurfacesSync} writes a new answer.
 *
 * The unresolved default is {@link FREE_TIER} — hide — and the direction is
 * chosen, not incidental. A surface that appears a moment late is a cosmetic
 * delay; a surface that is visible and then refuses is exactly the
 * shown-and-refused pattern App Store 3.1.1 rejects. Because the answer is
 * persisted, an entitled account only sees the default on the very first launch
 * after install.
 */
export function useFreemiumSurfaces(): FreemiumSurfaces {
  const [raw] = useMMKVString(STORAGE_KEYS.ENTITLED_SURFACES, storage);
  return parse(raw) ?? FREE_TIER;
}

/**
 * Keep the persisted answer current. Mounted ONCE, high in the tree
 * (`app/_layout.tsx`), alongside the other app-wide background hooks.
 *
 * Split from {@link useFreemiumSurfaces} so exactly one component holds the
 * query while any number of components read the result.
 */
export function useFreemiumSurfacesSync(enabled: boolean): void {
  const { data } = useQuotaUsage(enabled);

  useEffect(() => {
    if (!data) return;
    storage.set(
      STORAGE_KEYS.ENTITLED_SURFACES,
      JSON.stringify(surfacesFromQuotas(data.quotas)),
    );
  }, [data]);
}
