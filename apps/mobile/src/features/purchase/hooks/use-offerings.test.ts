import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { STORE_PRODUCT_IDS } from '../products';
import { packageFor, useOfferings } from './use-offerings';

// `mock`-prefixed so jest's hoisting rule permits the factory to close over it.
const mockGetOfferings = jest.fn();

jest.mock('../lib/purchases-sdk', () => ({
  __esModule: true,
  getPurchases: () => ({ getOfferings: mockGetOfferings }),
}));

/** A package shaped like the SDK's, with only the fields we read. */
function pkg(identifier: string, overrides: Record<string, unknown> = {}) {
  return {
    identifier: `$rc_${identifier}`,
    product: {
      identifier,
      title: 'LIBERTASIAN',
      priceString: '₱1,699.00',
      subscriptionPeriod: 'P1M',
      ...overrides,
    },
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

describe('useOfferings', () => {
  beforeEach(() => mockGetOfferings.mockReset());

  it('maps all four store product ids', async () => {
    const data = await offerings(
      STORE_PRODUCT_IDS.map((id) =>
        pkg(id, { subscriptionPeriod: id.endsWith('annual') ? 'P1Y' : 'P1M' }),
      ),
    );

    expect(data.plans.map((p) => p.productId)).toEqual([...STORE_PRODUCT_IDS]);
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
    // empty price is the violation; no card is not.
    const data = await offerings([
      pkg('com.libertasian.pro.monthly', { priceString: '' }),
    ]);

    expect(data.plans).toEqual([]);
  });

  it('drops a package whose period is not one we sell', async () => {
    // P1W is a product nobody configured. Guessing a label for it would put a
    // duration on screen that the store never quoted.
    const data = await offerings([
      pkg('com.libertasian.pro.monthly', { subscriptionPeriod: 'P1W' }),
    ]);

    expect(data.plans).toEqual([]);
  });

  it('renders the store period as words, monthly and annual', async () => {
    const data = await offerings([
      pkg('com.libertasian.pro.monthly', { subscriptionPeriod: 'P1M' }),
      pkg('com.libertasian.pro.annual', { subscriptionPeriod: 'P1Y' }),
    ]);

    expect(data.plans.map((p) => p.duration)).toEqual(['1 month', '1 year']);
  });

  it('returns nothing when the store has no current offering', async () => {
    mockGetOfferings.mockResolvedValue({ current: null });
    const { result } = renderHook(() => useOfferings(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ plans: [], packagesByProductId: {} });
  });

  it('resolves the package to purchase, and null for anything unmapped', async () => {
    const data = await offerings([pkg('com.libertasian.pro.monthly')]);

    expect(packageFor(data, 'com.libertasian.pro.monthly')).not.toBeNull();
    expect(packageFor(data, 'com.libertasian.edu.annual')).toBeNull();
    expect(packageFor(undefined, 'com.libertasian.pro.monthly')).toBeNull();
  });
});
