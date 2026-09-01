import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { apiClient } from '@/lib/api-client';

import {
  RESTORE_FAILED_NOTICE,
  RESTORE_NOTHING_NOTICE,
  UNCONFIRMED_NOTICE,
  usePurchaseOptions,
} from './use-purchase-options';

const ORG_ID = '11111111-1111-4111-8111-111111111111';

const mockConfigurePurchases = jest.fn();
const mockPurchasePackage = jest.fn();
const mockRestorePurchases = jest.fn();
const mockGetOfferings = jest.fn();

jest.mock('../lib/purchases-sdk', () => ({
  __esModule: true,
  configurePurchases: (...args: unknown[]) => mockConfigurePurchases(...args),
  getPurchases: () => ({
    getOfferings: mockGetOfferings,
    purchasePackage: mockPurchasePackage,
    restorePurchases: mockRestorePurchases,
  }),
  isUserCancelled: (error: unknown) =>
    typeof error === 'object' && error !== null && 'userCancelled' in error,
}));

jest.mock('@/providers/auth-provider', () => ({
  __esModule: true,
  useAuth: () => ({ user: { organizationId: ORG_ID } }),
}));

const MONTHLY = 'com.libertasian.pro.monthly' as const;

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

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

/** Render and wait for the offering to resolve to `ready`. */
async function renderReady() {
  const view = renderHook(() => usePurchaseOptions(), { wrapper });
  await waitFor(() => expect(view.result.current.status).toBe('ready'));
  return view;
}

describe('usePurchaseOptions', () => {
  let post: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfigurePurchases.mockResolvedValue(true);
    mockGetOfferings.mockResolvedValue({
      current: { availablePackages: [pkg(MONTHLY)] },
    });
    mockPurchasePackage.mockResolvedValue({ customerInfo: {} });
    mockRestorePurchases.mockResolvedValue({});
    // Resolve with the UNWRAPPED body, never `{ success, data }`. `apiClient`
    // strips the envelope itself (`unwrapEnvelope`), so a mock that returns the
    // wrapped shape describes a response this code never sees. These mocks used
    // to be wrapped, which is precisely what let the double-unwrap in
    // `store-sync.ts` pass its tests while every real restore silently failed.
    post = jest.spyOn(apiClient, 'post');
  });

  afterEach(() => post.mockRestore());

  // ---- D11: the App User ID is the organization id ----

  it('configures the SDK with the organization id as appUserID', async () => {
    // The server resolves a webhook's `app_user_id` straight to an organization
    // row. A user id, or an SDK-generated anonymous id, would produce purchases
    // the server cannot attribute to any tenant.
    await renderReady();
    expect(mockConfigurePurchases).toHaveBeenCalledWith(ORG_ID);
  });

  it('is unavailable when the SDK cannot be configured', async () => {
    // No RevenueCat key, or a binary without the native module. Neither is an
    // error the user can act on.
    mockConfigurePurchases.mockResolvedValue(false);
    const { result } = renderHook(() => usePurchaseOptions(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.plans).toEqual([]);
  });

  // ---- Purchase ----

  it('purchases the package for the requested product id', async () => {
    const { result } = await renderReady();

    await act(async () => result.current.purchase(MONTHLY));

    expect(mockPurchasePackage).toHaveBeenCalledTimes(1);
    expect(mockPurchasePackage.mock.calls[0]![0].product.identifier).toBe(MONTHLY);
  });

  it('NEVER purchases an unmapped product id', async () => {
    // The id has no package in the offering because `useOfferings` filtered it
    // out. This is the second of the two guards: even if a caller asked for
    // `team`, there is nothing to hand the SDK.
    const { result } = await renderReady();

    await act(async () => result.current.purchase('com.libertasian.edu.annual'));

    expect(mockPurchasePackage).not.toHaveBeenCalled();
  });

  it('reconciles with the server after a successful purchase', async () => {
    post.mockResolvedValue({ status: 'processed' });
    const { result } = await renderReady();

    await act(async () => result.current.purchase(MONTHLY));

    // D12 — the server is asked to PULL. Nothing about the entitlement is sent.
    expect(post).toHaveBeenCalledWith('/store/sync');
    expect(post.mock.calls[0]).toHaveLength(1);
    await waitFor(() => expect(result.current.notice).toBeNull());
  });

  // ---- The conduit_unconfigured path: today's normal case ----

  it('treats conduit_unconfigured as a neutral notice, not a failure', async () => {
    // This is what `/store/sync` answers on EVERY deployment today. The store
    // took the money and the entitlement is owed; telling the user something
    // broke would send them to file a refund for a purchase that worked.
    post.mockResolvedValue({ status: 'noop', detail: 'conduit_unconfigured' });
    const { result } = await renderReady();

    await act(async () => result.current.purchase(MONTHLY));

    await waitFor(() => expect(result.current.notice).toBe(UNCONFIRMED_NOTICE));
    // Neutral, and it points at the recovery the guidelines require anyway.
    expect(UNCONFIRMED_NOTICE).toMatch(/Restore Purchases/);
    expect(UNCONFIRMED_NOTICE).not.toMatch(/error|fail|sorry|problem/i);
  });

  it('treats an unreachable server the same neutral way', async () => {
    post.mockRejectedValue(new Error('network down'));
    const { result } = await renderReady();

    await act(async () => result.current.purchase(MONTHLY));

    await waitFor(() => expect(result.current.notice).toBe(UNCONFIRMED_NOTICE));
  });

  it('says nothing at all when the user dismisses the store sheet', async () => {
    // A cancelled purchase is not a failure and gets no message.
    mockPurchasePackage.mockRejectedValue({ userCancelled: true });
    const { result } = await renderReady();

    await act(async () => result.current.purchase(MONTHLY));

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.notice).toBeNull();
  });

  it('clears busy even when the purchase throws', async () => {
    mockPurchasePackage.mockRejectedValue(new Error('store down'));
    const { result } = await renderReady();

    await act(async () => result.current.purchase(MONTHLY));

    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  // ---- Restore ----

  it('restores through the SDK and then reconciles', async () => {
    post.mockResolvedValue({ status: 'processed' });
    const { result } = await renderReady();

    await act(async () => result.current.restore());

    expect(mockRestorePurchases).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/store/sync');
    await waitFor(() => expect(result.current.notice).toBeNull());
  });

  it('says nothing was restored, neutrally, when the server cannot confirm', async () => {
    post.mockResolvedValue({ status: 'noop', detail: 'conduit_unconfigured' });
    const { result } = await renderReady();

    await act(async () => result.current.restore());

    await waitFor(() => expect(result.current.notice).toBe(RESTORE_NOTHING_NOTICE));
    // Names no other account and no plan — §7's rule for the "already in use"
    // case, applied to every unconfirmed restore.
    expect(RESTORE_NOTHING_NOTICE).not.toMatch(/pro|edu|plan|account is/i);
  });

  /**
   * The catch used to set RESTORE_NOTHING_NOTICE, so a store that could not be
   * reached at all was reported as a store account with nothing on it — which
   * tells an entitled user their purchase does not exist.
   *
   * The prod tell: `reconcile()` POSTs `/store/sync` unconditionally after a
   * restore, and a full day of nginx logs contains no `/store/sync` request at
   * all. Every restore was throwing before it got that far, wearing the empty
   * result's message.
   */
  it('reports a thrown restore as a failure, NOT as an empty store account', async () => {
    mockRestorePurchases.mockRejectedValue(new Error('store unreachable'));
    const { result } = await renderReady();

    await act(async () => result.current.restore());

    await waitFor(() => expect(result.current.notice).toBe(RESTORE_FAILED_NOTICE));
    expect(result.current.notice).not.toBe(RESTORE_NOTHING_NOTICE);
    // It never reached the server, so it must not claim anything about the
    // store account.
    expect(post).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it('says nothing at all when the user dismisses the restore sheet', async () => {
    // Same rule as `purchase()`: a cancellation is not a failure.
    mockRestorePurchases.mockRejectedValue({ userCancelled: true });
    const { result } = await renderReady();

    await act(async () => result.current.restore());

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.notice).toBeNull();
  });
});
