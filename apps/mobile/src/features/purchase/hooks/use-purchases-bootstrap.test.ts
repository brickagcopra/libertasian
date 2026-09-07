import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { offeringKeys } from './use-offerings';
import { usePurchasesBootstrap } from './use-purchases-bootstrap';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG_ID = '22222222-2222-4222-8222-222222222222';
const MONTHLY = 'com.libertasian.pro.monthly';

const mockConfigurePurchases = jest.fn();
const mockGetOfferings = jest.fn();
const mockGetProducts = jest.fn();

// `mock`-prefixed so jest's hoisting rule permits the factory to close over it.
let mockSdkPresent = true;

jest.mock('../lib/purchases-sdk', () => ({
  __esModule: true,
  configurePurchases: (...args: unknown[]) => mockConfigurePurchases(...args),
  getPurchases: () =>
    mockSdkPresent
      ? { getOfferings: mockGetOfferings, getProducts: mockGetProducts }
      : null,
}));

function pkg(identifier: string) {
  return {
    identifier: `$rc_${identifier}`,
    product: {
      identifier,
      title: 'LIBERTASIAN Pro',
      priceString: '₱1,699.00',
      subscriptionPeriod: 'P1M',
    },
  };
}

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

describe('usePurchasesBootstrap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSdkPresent = true;
    // NO `gcTime: 0` here, unlike the sibling suites. A prefetched query has no
    // observer by definition, so a zero gcTime would collect it the instant it
    // resolved and the assertion below would be testing the test.
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockConfigurePurchases.mockResolvedValue(true);
    mockGetOfferings.mockResolvedValue({
      current: { availablePackages: [pkg(MONTHLY)] },
    });
    mockGetProducts.mockResolvedValue([]);
  });

  const cached = () => client.getQueryData(offeringKeys.current());

  it('does nothing at all while signed out', async () => {
    renderHook(() => usePurchasesBootstrap(null), { wrapper });

    // Not "configures with an empty id" — does not touch the store SDK. There
    // is no App User ID to configure with before there is a session, and D11
    // makes an anonymous one actively wrong: a purchase under it lands on no
    // tenant the server can resolve.
    expect(mockConfigurePurchases).not.toHaveBeenCalled();
    expect(mockGetOfferings).not.toHaveBeenCalled();
    expect(cached()).toBeUndefined();
  });

  it('does nothing while the session is still resolving', async () => {
    renderHook(() => usePurchasesBootstrap(undefined), { wrapper });

    expect(mockConfigurePurchases).not.toHaveBeenCalled();
  });

  it('configures with the organization id once a session exists', async () => {
    // D11 — the App User ID IS the organization id. The server resolves a
    // webhook's `app_user_id` straight to an organization row.
    renderHook(() => usePurchasesBootstrap(ORG_ID), { wrapper });

    await waitFor(() => expect(mockConfigurePurchases).toHaveBeenCalledWith(ORG_ID));
  });

  it('configures ONCE across re-renders', async () => {
    // It is mounted in the root layout, which re-renders on every navigation.
    const { rerender } = renderHook(
      (orgId: string | null) => usePurchasesBootstrap(orgId),
      { wrapper, initialProps: ORG_ID as string | null },
    );
    await waitFor(() => expect(mockConfigurePurchases).toHaveBeenCalledTimes(1));

    rerender(ORG_ID);
    rerender(ORG_ID);

    expect(mockConfigurePurchases).toHaveBeenCalledTimes(1);
  });

  it('warms the new tenant when the user switches organization', async () => {
    // A user in two orgs who switched context without this would leave the SDK
    // identified as the previous tenant.
    const { rerender } = renderHook(
      (orgId: string | null) => usePurchasesBootstrap(orgId),
      { wrapper, initialProps: ORG_ID as string | null },
    );
    await waitFor(() => expect(mockConfigurePurchases).toHaveBeenCalledTimes(1));

    rerender(OTHER_ORG_ID);

    await waitFor(() =>
      expect(mockConfigurePurchases).toHaveBeenCalledWith(OTHER_ORG_ID),
    );
  });

  // ---- the point: the store fetch happens before anyone needs it ----

  /**
   * THE 2.1(b) FIX. RevenueCat's subscriber record proves the reviewer's device
   * configured the SDK and reached RevenueCat; StoreKit returned no products.
   * Every cold-start cost used to be spent inside the window where the user was
   * already looking at a screen that needed prices. This moves it to launch.
   */
  it('prefetches the offering into the cache the purchase screen reads', async () => {
    renderHook(() => usePurchasesBootstrap(ORG_ID), { wrapper });

    await waitFor(() => expect(cached()).toBeDefined());
    expect(mockGetOfferings).toHaveBeenCalledTimes(1);
    // Under `offeringKeys.current()`, and shaped exactly as `useOfferings`
    // produces it — the prefetch spreads that query's own options.
    expect(cached()).toMatchObject({
      source: 'offering',
      plans: [expect.objectContaining({ productId: MONTHLY })],
    });
  });

  it('does not prefetch when the SDK could not be configured', async () => {
    // No RevenueCat key, or a binary without the native module. There is
    // nothing to ask and nothing to report.
    mockConfigurePurchases.mockResolvedValue(false);
    renderHook(() => usePurchasesBootstrap(ORG_ID), { wrapper });

    await waitFor(() => expect(mockConfigurePurchases).toHaveBeenCalledTimes(1));
    expect(mockGetOfferings).not.toHaveBeenCalled();
    expect(cached()).toBeUndefined();
  });

  // ---- it may never take app launch down ----

  it('does not throw when this binary has no store SDK', async () => {
    // Every Expo Go session, and any older build reached by a JS update.
    mockSdkPresent = false;
    const { result } = renderHook(() => usePurchasesBootstrap(ORG_ID), { wrapper });

    await waitFor(() => expect(mockConfigurePurchases).toHaveBeenCalledTimes(1));
    // The query throws OfferingsUnavailableError('no_sdk') inside the prefetch;
    // it must not escape as an unhandled rejection at app launch.
    expect(result.current).toBeUndefined();
    expect(cached()).toBeUndefined();
  });

  it('does not throw when configuring rejects outright', async () => {
    mockConfigurePurchases.mockRejectedValue(new Error('bridge gone'));
    const { result } = renderHook(() => usePurchasesBootstrap(ORG_ID), { wrapper });

    await waitFor(() => expect(mockConfigurePurchases).toHaveBeenCalledTimes(1));
    expect(result.current).toBeUndefined();
    expect(cached()).toBeUndefined();
  });

  it('does not throw when the store cannot be reached', async () => {
    mockGetOfferings.mockRejectedValue(new Error('StoreKit unreachable'));
    const { result } = renderHook(() => usePurchasesBootstrap(ORG_ID), { wrapper });

    await waitFor(() => expect(mockGetOfferings).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
    // An unreachable store at launch leaves nothing behind to mislead the
    // screen; it asks again on mount.
    expect(cached()).toBeUndefined();
  });

  it('renders nothing and returns nothing', async () => {
    // It is a warm-up, not a purchase door. The whole reason `app/_layout.tsx`
    // is allowed into PERMITTED_PURCHASE_ENTRY_POINTS.
    const { result } = renderHook(() => usePurchasesBootstrap(ORG_ID), { wrapper });
    expect(result.current).toBeUndefined();
  });
});
