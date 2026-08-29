import { renderHook } from '@testing-library/react-native';

import { storage, STORAGE_KEYS } from '../../storage/mmkv';
import {
  surfacesFromQuotas,
  useFreemiumSurfaces,
  useFreemiumSurfacesSync,
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

    it('falls back to the quota pair only when the field is absent', () => {
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
          digestsPerMonth: quota(0),
        }).scan,
      ).toBe(true);
    });
  });

  it('hides every paid surface when both generation quotas are 0', () => {
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
  ])('shows every paid surface for %s', (_label, quotas) => {
    expect(surfacesFromQuotas(quotas)).toEqual(ALL_VISIBLE);
  });

  it('follows a bonus or admin override without a client change', () => {
    // /quotas/usage limits come from resolveEffectiveEntitlements, so a granted
    // bonus raises the limit and the surfaces come back on their own.
    expect(
      surfacesFromQuotas({
        cameraScansPerMonth: quota(5), // 0 base + 5 bonus
        digestsPerMonth: quota(0),
      }).scan,
    ).toBe(true);
  });

  it('treats a missing quota key as 0 rather than as entitlement', () => {
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
      'resolves %s through the previewOnly fallback path too',
      (surface) => {
        // No previewOnly field at all — the quota-pair inference. A build that
        // outlives its API must still hide these, not default them on.
        expect(
          surfacesFromQuotas({
            cameraScansPerMonth: quota(0),
            digestsPerMonth: quota(0),
          })[surface],
        ).toBe(false);
        expect(
          surfacesFromQuotas({
            cameraScansPerMonth: quota(0),
            digestsPerMonth: quota(30),
          })[surface],
        ).toBe(true);
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
    ).toEqual(FREE_TIER);
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
    ).toEqual(ALL_VISIBLE);
  });

  it('writes the free-tier answer too — a downgrade must take the tabs away', () => {
    storage.set(STORAGE_KEYS.ENTITLED_SURFACES, JSON.stringify(ALL_VISIBLE));
    mockUseQuotaUsage.mockReturnValue({
      data: { quotas: { cameraScansPerMonth: quota(0), digestsPerMonth: quota(0) } },
    });

    renderHook(() => useFreemiumSurfacesSync(true));

    expect(
      JSON.parse(storage.getString(STORAGE_KEYS.ENTITLED_SURFACES) ?? '{}'),
    ).toEqual(FREE_TIER);
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
});
