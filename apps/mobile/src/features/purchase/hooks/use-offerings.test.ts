import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { STORE_PRODUCT_IDS } from '../products';
import {
  OfferingsUnavailableError,
  packageFor,
  productFor,
  useOfferings,
} from './use-offerings';

// `mock`-prefixed so jest's hoisting rule permits the factory to close over it.
const mockGetOfferings = jest.fn();
const mockGetProducts = jest.fn();

jest.mock('../lib/purchases-sdk', () => ({
  __esModule: true,
  getPurchases: () => mockSdk(),
}));

let sdkPresent = true;
const mockSdk = () =>
  sdkPresent
    ? { getOfferings: mockGetOfferings, getProducts: mockGetProducts }
    : null;

/** A raw store product, with only the fields we read. */
function product(identifier: string, overrides: Record<string, unknown> = {}) {
  return {
    identifier,
    title: 'LIBERTASIAN',
    priceString: '₱1,699.00',
    subscriptionPeriod: 'P1M',
    ...overrides,
  };
}

/** A package shaped like the SDK's, wrapping one product. */
function pkg(identifier: string, overrides: Record<string, unknown> = {}) {
  return {
    identifier: `$rc_${identifier}`,
    product: product(identifier, overrides),
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

async function offerings(availablePackages: unknown[]) {
  mockGetOfferings.mockResolvedValue({ current: { availablePackages } });
  const { result } = renderHook(() => useOfferings(true), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  return result.current.data!;
}

/**
 * Drive the hook to its error state.
 *
 * FAKE TIMERS ARE LOAD-BEARING. The query now retries three times with 1s / 2s
 * / 4s backoff — seven seconds of real waiting per case, past jest's default
 * timeout. The query's own `retry` overrides the client default, so the
 * wrapper's `retry: false` cannot switch it off, and switching it off in tests
 * would stop exercising the retry the fix adds.
 */
async function failure(): Promise<OfferingsUnavailableError> {
  jest.useFakeTimers();
  try {
    const { result } = renderHook(() => useOfferings(true), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 30_000,
    });
    return result.current.error as OfferingsUnavailableError;
  } finally {
    jest.useRealTimers();
  }
}

describe('useOfferings', () => {
  beforeEach(() => {
    sdkPresent = true;
    mockGetOfferings.mockReset();
    mockGetProducts.mockReset();
    // The fallback answers "the store has nothing" unless a case says otherwise.
    mockGetProducts.mockResolvedValue([]);
  });

  it('maps all four store product ids', async () => {
    const data = await offerings(
      STORE_PRODUCT_IDS.map((id) =>
        pkg(id, { subscriptionPeriod: id.endsWith('annual') ? 'P1Y' : 'P1M' }),
      ),
    );

    expect(data.plans.map((p) => p.productId)).toEqual([...STORE_PRODUCT_IDS]);
    expect(data.source).toBe('offering');
    // The offering path never reaches the store directly.
    expect(mockGetProducts).not.toHaveBeenCalled();
  });

  it('NEVER surfaces a product id the server would refuse', async () => {
    // A RevenueCat offering is dashboard-configured and can contain anything
    // someone added there. The server refuses every id outside
    // STORE_PRODUCT_MAP, so rendering one would offer a purchase the store
    // takes and we then decline — the failure with no clean resolution.
    const data = await offerings([
      pkg('com.libertasian.pro.monthly'),
      pkg('com.libertasian.team.monthly'),
      pkg('com.libertasian.enterprise.annual'),
      pkg('com.someone.else.pro.monthly'),
      pkg('rc_lifetime'),
    ]);

    expect(data.plans.map((p) => p.productId)).toEqual([
      'com.libertasian.pro.monthly',
    ]);
    expect(Object.keys(data.packagesByProductId)).toEqual([
      'com.libertasian.pro.monthly',
    ]);
  });

  it('orders by STORE_PRODUCT_IDS, not by the dashboard', async () => {
    // Otherwise rearranging the offering silently rearranges the screen.
    const data = await offerings([
      pkg('com.libertasian.edu.annual', { subscriptionPeriod: 'P1Y' }),
      pkg('com.libertasian.pro.monthly'),
    ]);

    expect(data.plans.map((p) => p.productId)).toEqual([
      'com.libertasian.pro.monthly',
      'com.libertasian.edu.annual',
    ]);
  });

  it('takes the price string from the store verbatim', async () => {
    const data = await offerings([
      pkg('com.libertasian.pro.monthly', { priceString: '$29.99' }),
    ]);

    // A different storefront, rendered as that storefront gave it. Nothing
    // converts, rounds or re-symbols it.
    expect(data.plans[0]!.priceString).toBe('$29.99');
  });

  it('drops a package with no price rather than showing a blank one', async () => {
    // 3.1.2(c) requires the price on screen before purchase. A card with an
    // empty price is the violation; no card is not. Still true.
    mockGetOfferings.mockResolvedValue({
      current: {
        availablePackages: [pkg('com.libertasian.pro.monthly', { priceString: '' })],
      },
    });

    const error = await failure();
    expect(error.reason).toBe('no_matching_packages');
  });

  // ---- the period no longer drops a card ----

  it('derives the period from the product id when the store gives none', async () => {
    // THE CHANGE. `subscriptionPeriod` is `string | null` in the SDK's own
    // types and is genuinely absent on some StoreKit paths. Dropping a fully
    // priced plan over it is how the purchase screen ends up empty in front of
    // a reviewer — and a missing period is not the 3.1.2(c) violation a
    // missing price is.
    const data = await offerings([
      pkg('com.libertasian.pro.monthly', { subscriptionPeriod: null }),
      pkg('com.libertasian.edu.annual', { subscriptionPeriod: undefined }),
    ]);

    expect(data.plans.map((p) => p.duration)).toEqual(['1 month', '1 year']);
  });

  it('derives the period from the product id when the store gives an odd one', async () => {
    // P1W on an id we own is a store record that disagrees with the product we
    // configured. The id is the one of the two we control, and the server's
    // STORE_PRODUCT_MAP reads the same suffix.
    const data = await offerings([
      pkg('com.libertasian.pro.monthly', { subscriptionPeriod: 'P1W' }),
    ]);

    expect(data.plans.map((p) => p.duration)).toEqual(['1 month']);
  });

  it('prefers the store period over the product id suffix', async () => {
    // Derivation is a FALLBACK. P1M/P1Y remain the primary source.
    const data = await offerings([
      pkg('com.libertasian.pro.monthly', { subscriptionPeriod: 'P1M' }),
      pkg('com.libertasian.pro.annual', { subscriptionPeriod: 'P1Y' }),
    ]);

    expect(data.plans.map((p) => p.duration)).toEqual(['1 month', '1 year']);
  });

  // ---- the direct-product fallback ----

  /**
   * THE 2.1(b) CASE. RevenueCat's `default` offering serves all four products
   * correctly, prod logs put the reviewer on this screen, and they still saw
   * "Plans are not available right now" — so the offering came back with
   * nothing usable ON DEVICE. Asking the store itself is the second question
   * the screen never used to ask.
   */
  it('falls back to the store directly when the offering yields nothing', async () => {
    mockGetOfferings.mockResolvedValue({ current: { availablePackages: [] } });
    mockGetProducts.mockResolvedValue(
      STORE_PRODUCT_IDS.map((id) =>
        product(id, { subscriptionPeriod: id.endsWith('annual') ? 'P1Y' : 'P1M' }),
      ),
    );

    const { result } = renderHook(() => useOfferings(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGetProducts).toHaveBeenCalledWith([...STORE_PRODUCT_IDS]);
    expect(result.current.data!.source).toBe('products');
    expect(result.current.data!.plans.map((p) => p.productId)).toEqual([
      ...STORE_PRODUCT_IDS,
    ]);
    // Nothing to buy WITH on this path, so the package map stays empty and
    // `productsByProductId` carries the raw products instead.
    expect(result.current.data!.packagesByProductId).toEqual({});
    expect(Object.keys(result.current.data!.productsByProductId)).toEqual([
      ...STORE_PRODUCT_IDS,
    ]);
  });

  it('falls back when there is no current offering at all', async () => {
    mockGetOfferings.mockResolvedValue({ current: null });
    mockGetProducts.mockResolvedValue([product('com.libertasian.pro.monthly')]);

    const { result } = renderHook(() => useOfferings(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.source).toBe('products');
    expect(result.current.data!.plans).toHaveLength(1);
  });

  it('still filters the fallback to ids the server would accept', async () => {
    // The direct fetch is a second path to the same screen, not a second set of
    // rules. `getProducts` is asked only for our four ids, but the store's
    // answer is filtered again rather than trusted.
    mockGetOfferings.mockResolvedValue({ current: { availablePackages: [] } });
    mockGetProducts.mockResolvedValue([
      product('com.libertasian.pro.monthly'),
      product('com.libertasian.team.monthly'),
      product('rc_lifetime'),
    ]);

    const { result } = renderHook(() => useOfferings(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.plans.map((p) => p.productId)).toEqual([
      'com.libertasian.pro.monthly',
    ]);
  });

  it('prefers the offering and does not ask the store twice', async () => {
    const data = await offerings([pkg('com.libertasian.pro.monthly')]);

    expect(data.source).toBe('offering');
    expect(mockGetProducts).not.toHaveBeenCalled();
  });

  // ---- an empty result is an ERROR, never a cached success ----

  /**
   * The five-minute dead end.
   *
   * This used to resolve `{ plans: [], packagesByProductId: {} }`, which React
   * Query cached as a SUCCESS for the full `staleTime`. A user staring at
   * "Plans are not available right now" had no action that could change it —
   * not backing out, not returning to the screen. That is what App Review saw.
   */
  it('THROWS rather than caching an empty result as a success', async () => {
    mockGetOfferings.mockResolvedValue({ current: { availablePackages: [] } });
    mockGetProducts.mockResolvedValue([]);

    const error = await failure();

    expect(error).toBeInstanceOf(OfferingsUnavailableError);
    expect(error.reason).toBe('products_empty');
  });

  it('reports no_sdk when this binary has no store SDK', async () => {
    sdkPresent = false;

    const error = await failure();

    expect(error.reason).toBe('no_sdk');
    expect(mockGetOfferings).not.toHaveBeenCalled();
  });

  it('reports offering_null when nothing answered anywhere', async () => {
    mockGetOfferings.mockResolvedValue({ current: null });
    mockGetProducts.mockResolvedValue([]);

    const error = await failure();

    expect(error.reason).toBe('offering_null');
  });

  it('reports no_matching_packages, with the ids the store did name', async () => {
    // The diagnostic that separates "the store returned nothing" from "the
    // store returned four ids we do not sell". Different bugs, different fixes.
    mockGetOfferings.mockResolvedValue({
      current: { availablePackages: [pkg('com.libertasian.team.monthly')] },
    });
    mockGetProducts.mockResolvedValue([]);

    const error = await failure();

    expect(error.reason).toBe('no_matching_packages');
    expect(error.rawProductIds).toEqual(['com.libertasian.team.monthly']);
  });

  it('carries the ids from both paths, deduplicated', async () => {
    mockGetOfferings.mockResolvedValue({
      current: { availablePackages: [pkg('rc_lifetime')] },
    });
    mockGetProducts.mockResolvedValue([
      product('rc_lifetime'),
      product('com.libertasian.team.annual'),
    ]);

    const error = await failure();

    expect(error.rawProductIds).toEqual(['rc_lifetime', 'com.libertasian.team.annual']);
  });

  it('retries a transient store failure before giving up', async () => {
    // The observed failure was transient — RevenueCat served all four products
    // correctly at the moment the device saw none. A single retry was not
    // enough to ride that out.
    jest.useFakeTimers();
    try {
      mockGetOfferings.mockRejectedValue(new Error('StoreKit unreachable'));
      const { result } = renderHook(() => useOfferings(true), { wrapper });
      await waitFor(() => expect(result.current.isError).toBe(true), {
        timeout: 30_000,
      });

      // One attempt plus three retries.
      expect(mockGetOfferings).toHaveBeenCalledTimes(4);
    } finally {
      jest.useRealTimers();
    }
  });

  // ---- resolving what to buy ----

  it('resolves the package to purchase, and null for anything unmapped', async () => {
    const data = await offerings([pkg('com.libertasian.pro.monthly')]);

    expect(packageFor(data, 'com.libertasian.pro.monthly')).not.toBeNull();
    expect(packageFor(data, 'com.libertasian.edu.annual')).toBeNull();
    expect(packageFor(undefined, 'com.libertasian.pro.monthly')).toBeNull();
  });

  it('resolves the raw product to purchase on the fallback path', async () => {
    mockGetOfferings.mockResolvedValue({ current: { availablePackages: [] } });
    mockGetProducts.mockResolvedValue([product('com.libertasian.pro.monthly')]);

    const { result } = renderHook(() => useOfferings(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(productFor(result.current.data, 'com.libertasian.pro.monthly')).not.toBeNull();
    expect(productFor(result.current.data, 'com.libertasian.edu.annual')).toBeNull();
    expect(productFor(undefined, 'com.libertasian.pro.monthly')).toBeNull();
  });
});
