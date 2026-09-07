import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

import { mobileAnalytics } from '@/lib/analytics';

import { createPurchaseTelemetry } from './purchase-telemetry';

// The real client pulls in expo-sqlite / NetInfo / MMKV, none of which resolve
// in this runner. We only care WHICH events reach `track()` and with what.
jest.mock('@/lib/analytics', () => ({
  __esModule: true,
  mobileAnalytics: { track: jest.fn(), trackPreAuth: jest.fn() },
}));

const MOBILE_SRC = join(__dirname, '..', '..', '..');

describe('createPurchaseTelemetry', () => {
  const track = mobileAnalytics.track as jest.Mock;

  beforeEach(() => track.mockReset());

  const eventNames = () => track.mock.calls.map((call) => call[0]);
  const payloads = () => track.mock.calls.map((call) => call[1]);

  it('reports an unavailable surface with its machine reason', async () => {
    createPurchaseTelemetry().surfaceUnavailable({
      reason: 'products_empty',
      source: 'products',
      rawProductIds: ['com.libertasian.team.monthly'],
    });

    expect(eventNames()).toEqual(['purchase_surface_unavailable']);
    expect(payloads()[0]).toMatchObject({
      reason: 'products_empty',
      source: 'products',
      rawProductIds: ['com.libertasian.team.monthly'],
    });
  });

  /**
   * The purchase screen re-renders on every query state change and the
   * unavailable state is sticky, so an undeduplicated report would post one
   * event per render and bury the signal it exists to carry.
   */
  it('fires the unavailable event once per reason per mount', () => {
    const telemetry = createPurchaseTelemetry();

    telemetry.surfaceUnavailable({ reason: 'products_empty' });
    telemetry.surfaceUnavailable({ reason: 'products_empty' });
    telemetry.surfaceUnavailable({ reason: 'products_empty' });

    expect(eventNames()).toEqual(['purchase_surface_unavailable']);
  });

  it('still reports a DIFFERENT reason on the same mount', () => {
    // A different reason is a different fact. Deduplicating those away would
    // hide the transition we most want to see.
    const telemetry = createPurchaseTelemetry();

    telemetry.surfaceUnavailable({ reason: 'sdk_failed' });
    telemetry.surfaceUnavailable({ reason: 'products_empty' });

    expect(payloads().map((p) => p!.reason)).toEqual([
      'sdk_failed',
      'products_empty',
    ]);
  });

  it('starts a fresh dedupe window for each mount', () => {
    // A user who leaves the screen and comes back has given the store another
    // chance to answer; that second visit is a new observation.
    createPurchaseTelemetry().surfaceUnavailable({ reason: 'offering_null' });
    createPurchaseTelemetry().surfaceUnavailable({ reason: 'offering_null' });

    expect(eventNames()).toHaveLength(2);
  });

  it('reports a ready surface once, with its plan count and source', () => {
    const telemetry = createPurchaseTelemetry();

    telemetry.surfaceReady({ planCount: 4, source: 'offering' });
    telemetry.surfaceReady({ planCount: 4, source: 'offering' });

    expect(eventNames()).toEqual(['purchase_surface_ready']);
    expect(payloads()[0]).toMatchObject({ planCount: 4, source: 'offering' });
  });

  it('reports every purchase and restore outcome, undeduplicated', () => {
    // These are per-attempt facts, not per-mount states. A user who fails and
    // then succeeds must produce both events.
    const telemetry = createPurchaseTelemetry();

    telemetry.purchaseResult('failed');
    telemetry.purchaseResult('confirmed');
    telemetry.restoreResult('nothing');
    telemetry.restoreResult('confirmed');

    expect(eventNames()).toEqual([
      'purchase_result',
      'purchase_result',
      'restore_result',
      'restore_result',
    ]);
    expect(payloads().map((p) => p!.outcome)).toEqual([
      'failed',
      'confirmed',
      'nothing',
      'confirmed',
    ]);
  });

  it('names no source when there was none', () => {
    createPurchaseTelemetry().surfaceUnavailable({ reason: 'no_sdk' });

    expect(payloads()[0]).toMatchObject({ source: 'none', rawProductIds: [] });
  });

  it('caps the raw product ids rather than trusting their size', () => {
    // Store-supplied strings are attacker-influenced in the general case and we
    // persist them server-side.
    createPurchaseTelemetry().surfaceUnavailable({
      reason: 'no_matching_packages',
      rawProductIds: Array.from({ length: 40 }, (_, i) => `id.${i}`.repeat(80)),
    });

    const ids = payloads()[0]!.rawProductIds as string[];
    expect(ids.length).toBeLessThanOrEqual(12);
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(120);
  });

  // ---- what may never be sent ----

  it('sends no price, no currency and no account identity', () => {
    // The payload is persisted server-side. Product ids are ours — the four
    // constants in `products.ts`, which are the server's own
    // `STORE_PRODUCT_MAP` keys — and they are the whole diagnostic value here.
    const telemetry = createPurchaseTelemetry();
    telemetry.surfaceUnavailable({
      reason: 'products_empty',
      source: 'products',
      rawProductIds: ['com.libertasian.pro.monthly'],
    });
    telemetry.surfaceReady({ planCount: 4, source: 'products' });
    telemetry.purchaseResult('confirmed');
    telemetry.restoreResult('confirmed');

    const keys = new Set(payloads().flatMap((p) => Object.keys(p ?? {})));
    for (const forbidden of [
      'email',
      'userId',
      'organizationId',
      'appUserID',
      'price',
      'priceString',
      'currencyCode',
      'title',
      'transaction',
    ]) {
      expect([...keys]).not.toContain(forbidden);
    }

    const serialized = JSON.stringify(payloads());
    expect(serialized).not.toMatch(/₱|\$\d/);
  });

  // ---- confinement ----

  /**
   * This module names purchasable things, so it lives under
   * `features/purchase/` where `no-purchase-copy.test.ts` exempts it BY
   * LOCATION. An importer outside the purchase surface would drag that naming
   * onto a screen with no way to buy — the shape of the 3.1.1 rejection.
   */
  it('is imported from nowhere outside the purchase surface', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return walk(full);
        return /\.tsx?$/.test(entry) ? [full] : [];
      });

    const importers = walk(MOBILE_SRC)
      .map((file) => relative(MOBILE_SRC, file).split(sep).join('/'))
      .filter((file) => /purchase-telemetry/.test(readFileSync(join(MOBILE_SRC, file), 'utf8')))
      .filter((file) => !file.endsWith('lib/purchase-telemetry.ts'))
      .filter((file) => !file.endsWith('lib/purchase-telemetry.test.ts'));

    // A floor: if the walk stopped resolving files the assertion below would
    // pass on an empty list and this whole test would be decorative.
    expect(importers).toContain('features/purchase/hooks/use-purchase-options.ts');

    expect(
      importers.filter(
        (file) =>
          !file.startsWith('features/purchase/') && !file.startsWith('app/purchase/'),
      ),
    ).toEqual([]);
  });
});
