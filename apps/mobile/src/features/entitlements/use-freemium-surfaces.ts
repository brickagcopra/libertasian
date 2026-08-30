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
  /** Study: flashcards, reviewer packs, sessions, syllabus, community. */
  study: boolean;
  /** Past bar exam questions. */
  barExams: boolean;
  /**
   * Generating a digest from a document. Distinct from {@link study} because
   * it hangs off Digests and Search, which stay reachable — only the generate
   * affordance goes.
   */
  digestGeneration: boolean;
  /** Matters, memos, pleadings, comparisons, timelines, tasks, notes. */
  workspace: boolean;
}

/**
 * The one persisted answer, and everything read off it.
 *
 * `surfaces` is WHETHER TO RENDER the surface at all; `entitled` is whether the
 * account may see its paid CONTENT. They are the same value today and diverge
 * only under D14 mechanism C, where a free account on a platform with a live
 * store gets the surface WITH a purchase entry point instead of the content.
 *
 * All three live in ONE blob, deliberately. Two caches would let the answers
 * disagree — a stale `storePurchaseAvailable: true` beside a fresh
 * `entitled: false` renders a purchase entry point for a store that is not
 * live, and the opposite hides a surface a paying user just bought. They are
 * written together or not at all.
 */
export interface SurfaceAccess {
  surfaces: FreemiumSurfaces;
  /** `!previewOnly`. May this account see PAID CONTENT? */
  entitled: boolean;
  /** D14: is a store purchase live and approved on THIS platform? */
  storePurchaseAvailable: boolean;
}

/** Everything visible. What an entitled account resolves to. */
const ALL_VISIBLE: FreemiumSurfaces = {
  scan: true,
  study: true,
  barExams: true,
  digestGeneration: true,
  workspace: true,
};

/**
 * Nothing paid visible. What a free account resolves to, and also the
 * pre-resolution default — see {@link useFreemiumSurfaces}.
 *
 * Statutory codals are NOT listed here and have no flag: they are free to
 * read, so `app/codals/` carries no guard at all rather than a flag that is
 * always true.
 */
const FREE_TIER: FreemiumSurfaces = {
  scan: false,
  study: false,
  barExams: false,
  digestGeneration: false,
  workspace: false,
};

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
  return isEntitled(quotas, previewOnly) ? ALL_VISIBLE : FREE_TIER;
}

/** The entitlement decision on its own, shared by both readings above. */
function isEntitled(
  quotas: Record<string, { limit: number }>,
  previewOnly?: boolean,
): boolean {
  if (typeof previewOnly === 'boolean') return !previewOnly;

  const limitOf = (key: string): number => quotas[key]?.limit ?? 0;
  return limitOf('cameraScansPerMonth') !== 0 || limitOf('digestsPerMonth') !== 0;
}

/**
 * The full answer, from one `/quotas/usage` response (D14 mechanism C).
 *
 * A surface is VISIBLE when the account is entitled to it, OR when it is not
 * but a store purchase is available on this platform — the second case being
 * the whole mechanism: show the surface, with a purchase entry point instead of
 * its paid content.
 *
 * With `storePurchaseAvailable` false — which is every deployment until a
 * platform's products are live and approved — this reduces EXACTLY to the
 * previous behaviour: visible iff entitled. That equivalence is the safety
 * property the flag exists to provide, and `use-freemium-surfaces.test.tsx`
 * asserts it rather than trusting this comment.
 */
export function accessFromQuotas(
  quotas: Record<string, { limit: number }>,
  previewOnly?: boolean,
  storePurchaseAvailable?: boolean,
): SurfaceAccess {
  const entitled = isEntitled(quotas, previewOnly);
  const canPurchase = storePurchaseAvailable === true;

  return {
    surfaces: entitled || canPurchase ? ALL_VISIBLE : FREE_TIER,
    entitled,
    storePurchaseAvailable: canPurchase,
  };
}

/**
 * The persisted shape. The five surface flags stay at the TOP LEVEL exactly
 * where they were, so a build that shipped before this change reads a blob
 * written after it without seeing anything new — and ignores the two added
 * keys, which is the correct degradation for a client that has no purchase
 * surface.
 */
interface PersistedAccess extends Partial<FreemiumSurfaces> {
  entitled?: boolean;
  storePurchaseAvailable?: boolean;
}

function parse(raw: string | undefined): SurfaceAccess | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedAccess;
    const surfaces: FreemiumSurfaces = {
      scan: parsed.scan === true,
      study: parsed.study === true,
      barExams: parsed.barExams === true,
      digestGeneration: parsed.digestGeneration === true,
      workspace: parsed.workspace === true,
    };

    return {
      surfaces,
      // A blob written by an OLDER build carries no `entitled` key. Falling
      // back to "visible means entitled" is exactly what that build meant, and
      // it keeps a mid-upgrade read from rendering a purchase entry point on a
      // surface the user is already paying for.
      entitled:
        typeof parsed.entitled === 'boolean'
          ? parsed.entitled
          : surfaces.scan || surfaces.study || surfaces.workspace,
      storePurchaseAvailable: parsed.storePurchaseAvailable === true,
    };
  } catch {
    // A corrupt value is a cache miss, never a crash on launch.
    return null;
  }
}

/** Nothing paid, nothing purchasable. The pre-resolution default. */
const NO_ACCESS: SurfaceAccess = {
  surfaces: FREE_TIER,
  entitled: false,
  storePurchaseAvailable: false,
};

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
  return useSurfaceAccess().surfaces;
}

/**
 * The full answer: what to render, and whether the content is unlocked.
 *
 * `useFreemiumSurfaces()` stays as it was and returns only the surface flags,
 * because seventeen screens' tab bars read it and none of them care about the
 * distinction. Only `SurfaceGuard` needs both halves.
 */
export function useSurfaceAccess(): SurfaceAccess {
  const [raw] = useMMKVString(STORAGE_KEYS.ENTITLED_SURFACES, storage);
  return parse(raw) ?? NO_ACCESS;
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
    const access = accessFromQuotas(
      data.quotas,
      data.previewOnly,
      data.storePurchaseAvailable,
    );
    // ONE write, ONE key. The surface flags stay at the top level so an older
    // build reading this blob sees exactly what it always did.
    storage.set(
      STORAGE_KEYS.ENTITLED_SURFACES,
      JSON.stringify({
        ...access.surfaces,
        entitled: access.entitled,
        storePurchaseAvailable: access.storePurchaseAvailable,
      }),
    );
  }, [data]);
}
