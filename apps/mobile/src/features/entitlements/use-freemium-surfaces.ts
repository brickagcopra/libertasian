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
 * locked after the API had stopped locking them.
 *
 * PRIMARY SIGNAL: `previewOnly` on `/quotas/usage`. It is the server's own
 * `resolveEffectiveEntitlements().previewOnly` — literally the value
 * `DocumentsController` and `SearchController` gate on — so the client hides
 * exactly what the server refuses, with no reasoning of its own in between.
 *
 * FALLBACK: the `cameraScansPerMonth` / `digestsPerMonth` pair, used ONLY when
 * `previewOnly` is absent from the response. It is not a second opinion; it is
 * what a build talks to when it outlives its API. Store rollouts are gradual
 * and builds live on devices for months, so a shipped client will meet an API
 * without the field. Treating a missing field as "entitled" would put Scan and
 * Study in front of a free account on every older deployment.
 *
 * The fallback is an INFERENCE and it is wrong in a case the flag gets right:
 * both quotas are 0 on today's free tier and positive on every paid one, but a
 * plan with generation quotas and no corpus entitlement would read as entitled.
 * That is precisely why the flag exists — never promote the fallback back to
 * primary because it happens to agree on the current plan table.
 */
export function surfacesFromQuotas(
  quotas: Record<string, { limit: number }>,
  previewOnly?: boolean,
): FreemiumSurfaces {
  if (typeof previewOnly === 'boolean') {
    return previewOnly ? FREE_TIER : ALL_VISIBLE;
  }

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
      JSON.stringify(surfacesFromQuotas(data.quotas, data.previewOnly)),
    );
  }, [data]);
}
