import { renderHook } from '@testing-library/react-native';

import { storage, STORAGE_KEYS } from '../../storage/mmkv';
import {
  accessFromQuotas,
  surfacesFromQuotas,
  useFreemiumSurfaces,
  useFreemiumSurfacesSync,
  useSurfaceAccess,
  type FreemiumSurfaces,
} from './use-freemium-surfaces';

const mockUseQuotaUsage = jest.fn();
jest.mock('../billing/hooks/use-quotas', () => ({
  useQuotaUsage: (enabled?: boolean) => mockUseQuotaUsage(enabled),
}));

const quota = (limit: number) => ({ limit });

/**
 * Written out rather than imported: the point of these assertions is that the
 * shape is exactly this, so a flag added to the module without a decision
 * about the free tier fails here instead of shipping as `undefined`.
 */
const ALL_VISIBLE: FreemiumSurfaces = {
  scan: true,
  study: true,
  barExams: true,
  digestGeneration: true,
  workspace: true,
};

const FREE_TIER: FreemiumSurfaces = {
  scan: false,
  study: false,
  barExams: false,
  digestGeneration: false,
  workspace: false,
};

beforeEach(() => {
  storage.delete(STORAGE_KEYS.ENTITLED_SURFACES);
  mockUseQuotaUsage.mockReturnValue({ data: undefined });
});

/**
 * The gate reads the SERVER's resolved limits, never a plan code. See the
 * module doc: `meetsMinimumTier()` was deleted for re-deriving entitlement on
 * the client, and this must not reintroduce it.
 */
describe('surfacesFromQuotas', () => {
  describe('previewOnly — the primary signal', () => {
    it('hides every surface when previewOnly is true, whatever the quotas say', () => {
      // THE case the quota inference gets wrong: positive generation quotas on
      // an account that still cannot read the paid corpora. The flag is the
      // server's own resolveEffectiveEntitlements().previewOnly, so it wins.
      expect(
        surfacesFromQuotas(
          { cameraScansPerMonth: quota(25), digestsPerMonth: quota(100) },
          true,
        ),
      ).toEqual(FREE_TIER);
    });

    it('shows every surface when previewOnly is false, whatever the quotas say', () => {
      // The mirror image: an entitled account that has exhausted its
      // allowances still reaches the surfaces. A spent quota is a 429, not a
      // reason to remove the feature.
      expect(
        surfacesFromQuotas(
          { cameraScansPerMonth: quota(0), digestsPerMonth: quota(0) },
          false,
        ),
      ).toEqual(ALL_VISIBLE);
    });

    it('resolves to NOT ENTITLED when the field is absent, whatever the quotas say', () => {
      // A shipped build outliving the API version that added previewOnly.
      // Treating the missing field as "entitled" would put Scan and Study in
      // front of a free account on every older deployment.
      expect(
        surfacesFromQuotas({
          cameraScansPerMonth: quota(0),
          digestsPerMonth: quota(0),
        }).scan,
      ).toBe(false);
      expect(
        surfacesFromQuotas({
          cameraScansPerMonth: quota(10),
          digestsPerMonth: quota(30),
        }).scan,
      ).toBe(false);
    });
  });

  /**
   * THE case the fallback now has to get right. Free resolves to aiAnswers 3 /
   * cameraScansPerMonth 1 / digestsPerMonth 1 — every quota positive on
   * purpose, so that exhausting one returns 429 quota_exceeded and never the
   * 402 App Review reads as a paywall. The old
   * `cameraScansPerMonth !== 0 || digestsPerMonth !== 0` inference read exactly
   * that shape as ENTITLED and would hand a free account Scan, Study, Bar
   * Exams, Digest Generation and Workspace with no purchase prompt anywhere.
   */
  it('hides every paid surface for a free account whose quotas are positive', () => {
    expect(
      surfacesFromQuotas({
        aiAnswers: quota(3),
        cameraScansPerMonth: quota(1),
        digestsPerMonth: quota(1),
      }),
    ).toEqual(FREE_TIER);
  });

  it('hides every paid surface when the quotas are 0 and previewOnly is absent', () => {
    expect(
      surfacesFromQuotas({
        cameraScansPerMonth: quota(0),
        digestsPerMonth: quota(0),
      }),
    ).toEqual(FREE_TIER);
  });

  it.each([
    ['a finite scan allowance', { cameraScansPerMonth: quota(10), digestsPerMonth: quota(0) }],
    ['a finite digest allowance', { cameraScansPerMonth: quota(0), digestsPerMonth: quota(30) }],
    ['unlimited', { cameraScansPerMonth: quota(-1), digestsPerMonth: quota(-1) }],
  ])('never grants a surface on the strength of %s alone', (_label, quotas) => {
    // Quota size says HOW MUCH of a metered action an account may perform. It
    // never said which corpora it may READ, and the two stopped coinciding the
    // moment the free tier got quotas of its own.
    expect(surfacesFromQuotas(quotas)).toEqual(FREE_TIER);
    expect(surfacesFromQuotas(quotas, true)).toEqual(FREE_TIER);
    expect(surfacesFromQuotas(quotas, false)).toEqual(ALL_VISIBLE);
  });

  it('does not turn a surface on because a bonus raised a quota', () => {
    // /quotas/usage limits come from resolveEffectiveEntitlements, so a granted
    // bonus does raise the limit — but a bonus buys more of a metered action,
    // not access to the paid corpora. Only previewOnly moves this.
    expect(
      surfacesFromQuotas({
        cameraScansPerMonth: quota(5), // 1 base + 4 bonus
        digestsPerMonth: quota(1),
      }).scan,
    ).toBe(false);
    expect(
      surfacesFromQuotas({ cameraScansPerMonth: quota(5) }, false).scan,
    ).toBe(true);
  });

  it('treats an empty quota map as no entitlement', () => {
    expect(surfacesFromQuotas({})).toEqual(FREE_TIER);
  });

  /**
   * The two surfaces added when the mapping was corrected. They derive from
   * the same `previewOnly` value as the rest — no extra client-side reasoning
   * — so these cases exist to pin that, not to describe separate logic.
   */
  describe('digestGeneration and workspace', () => {
    it.each(['digestGeneration', 'workspace'] as const)(
      'hides %s on the free tier',
      (surface) => {
        expect(surfacesFromQuotas({}, true)[surface]).toBe(false);
      },
    );

    it.each(['digestGeneration', 'workspace'] as const)(
      'shows %s on an entitled account',
      (surface) => {
        expect(surfacesFromQuotas({}, false)[surface]).toBe(true);
      },
    );

    it.each(['digestGeneration', 'workspace'] as const)(
      'hides %s whenever previewOnly is absent, positive quotas included',
      (surface) => {
        // No previewOnly field at all — a build that outlives its API must
        // hide these, and a free tier with real allowances must not read as a
        // reason to show them.
        expect(
          surfacesFromQuotas({
            cameraScansPerMonth: quota(0),
            digestsPerMonth: quota(0),
          })[surface],
        ).toBe(false);
        expect(
          surfacesFromQuotas({
            cameraScansPerMonth: quota(1),
            digestsPerMonth: quota(1),
          })[surface],
        ).toBe(false);
      },
    );

    it('never resolves independently of the other surfaces', () => {
      // Both come from ALL_VISIBLE / FREE_TIER, so there is exactly one
      // decision. If a future change gives either its own rule, this fails.
      for (const previewOnly of [true, false]) {
        const resolved = surfacesFromQuotas({}, previewOnly);
        expect(new Set(Object.values(resolved)).size).toBe(1);
      }
    });
  });
});

describe('useFreemiumSurfaces', () => {
  it('defaults to hidden when nothing has been resolved yet', () => {
    // Chosen direction: a surface that appears a moment late is cosmetic; one
    // that is visible and then refuses is the pattern 3.1.1 rejects.
    const { result } = renderHook(() => useFreemiumSurfaces());
    expect(result.current).toEqual(FREE_TIER);
  });

  it('reads the persisted answer synchronously — no provider, no loading pass', () => {
    storage.set(STORAGE_KEYS.ENTITLED_SURFACES, JSON.stringify(ALL_VISIBLE));

    const { result } = renderHook(() => useFreemiumSurfaces());
    expect(result.current).toEqual(ALL_VISIBLE);
  });

  it('falls back to hidden on a corrupt persisted value instead of crashing', () => {
    storage.set(STORAGE_KEYS.ENTITLED_SURFACES, 'not json');

    const { result } = renderHook(() => useFreemiumSurfaces());
    expect(result.current).toEqual(FREE_TIER);
  });

  it('never infers entitlement from a partial persisted value', () => {
    // An answer written by an older build, which knew nothing of the two new
    // flags. The missing keys read as hidden, never as entitled.
    storage.set(
      STORAGE_KEYS.ENTITLED_SURFACES,
      JSON.stringify({ scan: true, study: true, barExams: true }),
    );

    const { result } = renderHook(() => useFreemiumSurfaces());
    expect(result.current).toEqual({
      ...ALL_VISIBLE,
      digestGeneration: false,
      workspace: false,
    });
  });
});

describe('useFreemiumSurfacesSync', () => {
  it('does not query while signed out', () => {
    renderHook(() => useFreemiumSurfacesSync(false));
    expect(mockUseQuotaUsage).toHaveBeenCalledWith(false);
  });

  it('passes previewOnly through to the resolver', () => {
    mockUseQuotaUsage.mockReturnValue({
      data: {
        // Quotas that would read as entitled under the fallback.
        quotas: { cameraScansPerMonth: quota(25), digestsPerMonth: quota(100) },
        previewOnly: true,
      },
    });

    renderHook(() => useFreemiumSurfacesSync(true));

    expect(
      JSON.parse(storage.getString(STORAGE_KEYS.ENTITLED_SURFACES) ?? '{}'),
    ).toMatchObject(FREE_TIER);
  });

  it('persists the resolved answer so the next cold start does not flicker', () => {
    mockUseQuotaUsage.mockReturnValue({
      data: {
        quotas: { cameraScansPerMonth: quota(-1), digestsPerMonth: quota(-1) },
        previewOnly: false,
      },
    });

    renderHook(() => useFreemiumSurfacesSync(true));

    expect(
      JSON.parse(storage.getString(STORAGE_KEYS.ENTITLED_SURFACES) ?? '{}'),
    ).toMatchObject(ALL_VISIBLE);
  });

  it('writes the free-tier answer too — a downgrade must take the tabs away', () => {
    storage.set(STORAGE_KEYS.ENTITLED_SURFACES, JSON.stringify(ALL_VISIBLE));
    mockUseQuotaUsage.mockReturnValue({
      data: {
        quotas: { cameraScansPerMonth: quota(1), digestsPerMonth: quota(1) },
        previewOnly: true,
      },
    });

    renderHook(() => useFreemiumSurfacesSync(true));

    expect(
      JSON.parse(storage.getString(STORAGE_KEYS.ENTITLED_SURFACES) ?? '{}'),
    ).toMatchObject(FREE_TIER);
  });

  it('leaves the persisted answer alone while the query has no data', () => {
    storage.set(STORAGE_KEYS.ENTITLED_SURFACES, JSON.stringify(ALL_VISIBLE));

    renderHook(() => useFreemiumSurfacesSync(true));

    // An offline launch keeps the last known answer rather than demoting a
    // paying user to the free layout.
    expect(
      JSON.parse(storage.getString(STORAGE_KEYS.ENTITLED_SURFACES) ?? '{}').study,
    ).toBe(true);
  });

  // ======================================================================
  // D14 mechanism C — storePurchaseAvailable
  // ======================================================================

  describe('storePurchaseAvailable', () => {
    // The live free tier: positive quotas, no access to the paid corpora.
    const freeQuotas = {
      aiAnswers: quota(3),
      cameraScansPerMonth: quota(1),
      digestsPerMonth: quota(1),
    };

    it('WITH THE FLAG FALSE, behaves exactly as before', () => {
      // THE safety property of mechanism C: the first IAP build must behave
      // identically to the currently approved one, which is what makes it safe
      // to submit while store products are still in review. Asserted as an
      // equivalence against the pre-existing resolver rather than restated, so
      // the two cannot drift.
      for (const previewOnly of [true, false]) {
        for (const flag of [undefined, false]) {
          expect(accessFromQuotas(freeQuotas, previewOnly, flag).surfaces).toEqual(
            surfacesFromQuotas(freeQuotas, previewOnly),
          );
        }
      }
    });

    it('keeps a free account hidden when no store purchase is available', () => {
      const access = accessFromQuotas(freeQuotas, true, false);

      expect(access.surfaces).toEqual(FREE_TIER);
      expect(access.entitled).toBe(false);
      expect(access.storePurchaseAvailable).toBe(false);
    });

    it('SHOWS the surface to a free account once a purchase is available', () => {
      // D14 option B: the reasoning behind "always hide" was conditional on
      // there being no way to buy. This is that condition being removed.
      const access = accessFromQuotas(freeQuotas, true, true);

      expect(access.surfaces).toEqual(ALL_VISIBLE);
      // ...but the account is still NOT entitled to the content. That gap is
      // what SurfaceGuard renders the purchase entry point into.
      expect(access.entitled).toBe(false);
    });

    it('leaves an entitled account entitled regardless of the flag', () => {
      const paid = { cameraScansPerMonth: quota(-1), digestsPerMonth: quota(-1) };

      for (const flag of [undefined, false, true]) {
        const access = accessFromQuotas(paid, false, flag);
        expect(access.surfaces).toEqual(ALL_VISIBLE);
        expect(access.entitled).toBe(true);
      }
    });

    it('persists both new values in the SAME blob as the surface flags', () => {
      // Two caches would let the answers disagree — a stale
      // storePurchaseAvailable beside a fresh entitled renders a purchase entry
      // point for a store that is not live, or hides a surface someone just
      // bought.
      mockUseQuotaUsage.mockReturnValue({
        data: { quotas: freeQuotas, previewOnly: true, storePurchaseAvailable: true },
      });

      renderHook(() => useFreemiumSurfacesSync(true));

      const blob = JSON.parse(
        storage.getString(STORAGE_KEYS.ENTITLED_SURFACES) ?? '{}',
      );
      expect(blob).toEqual({
        ...ALL_VISIBLE,
        entitled: false,
        storePurchaseAvailable: true,
      });
    });

    it('reads both values back off that one blob', () => {
      storage.set(
        STORAGE_KEYS.ENTITLED_SURFACES,
        JSON.stringify({ ...ALL_VISIBLE, entitled: false, storePurchaseAvailable: true }),
      );

      const { result } = renderHook(() => useSurfaceAccess());

      expect(result.current.surfaces).toEqual(ALL_VISIBLE);
      expect(result.current.entitled).toBe(false);
      expect(result.current.storePurchaseAvailable).toBe(true);
    });

    it('treats a blob from an older build as entitled where it was visible', () => {
      // A build that shipped before this change wrote no `entitled` key. Its
      // visible surfaces meant entitled, and reading them as unentitled would
      // put a purchase entry point in front of a paying user mid-upgrade.
      storage.set(STORAGE_KEYS.ENTITLED_SURFACES, JSON.stringify(ALL_VISIBLE));

      const { result } = renderHook(() => useSurfaceAccess());

      expect(result.current.entitled).toBe(true);
      expect(result.current.storePurchaseAvailable).toBe(false);
    });

    it('defaults to no access at all before the first resolution', () => {
      const { result } = renderHook(() => useSurfaceAccess());

      expect(result.current.surfaces).toEqual(FREE_TIER);
      expect(result.current.entitled).toBe(false);
      expect(result.current.storePurchaseAvailable).toBe(false);
    });
  });
});
