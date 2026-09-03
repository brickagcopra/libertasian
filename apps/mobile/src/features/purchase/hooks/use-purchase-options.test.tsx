import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { apiClient } from '@/lib/api-client';

import {
  PURCHASE_CONFIRMED_NOTICE,
  PURCHASE_FAILED_NOTICE,
  RESTORE_CONFIRMED_NOTICE,
  RESTORE_FAILED_NOTICE,
  RESTORE_NOTHING_NOTICE,
  usePurchaseOptions,
} from './use-purchase-options';

const ORG_ID = '11111111-1111-4111-8111-111111111111';

const mockConfigurePurchases = jest.fn();
const mockPurchasePackage = jest.fn();
const mockRestorePurchases = jest.fn();
const mockGetOfferings = jest.fn();
const mockGetCustomerInfo = jest.fn();

/** A `CustomerInfo` the store considers entitled. */
const ENTITLED = { entitlements: { active: { pro: { isActive: true } } } };
/** A `CustomerInfo` the store considers to own nothing. */
const NOT_ENTITLED = { entitlements: { active: {} } };

jest.mock('../lib/purchases-sdk', () => ({
  __esModule: true,
  configurePurchases: (...args: unknown[]) => mockConfigurePurchases(...args),
  getPurchases: () => ({
    getOfferings: mockGetOfferings,
    purchasePackage: mockPurchasePackage,
    restorePurchases: mockRestorePurchases,
    getCustomerInfo: mockGetCustomerInfo,
  }),
  isUserCancelled: (error: unknown) =>
    typeof error === 'object' && error !== null && 'userCancelled' in error,
  // NOT mocked away. This is the predicate the whole fix turns on, so the hook
  // must be exercised against the real one — a stub here would let a broken
  // `hasActiveEntitlement` pass every case below.
  hasActiveEntitlement: (info: unknown) =>
    jest.requireActual('../lib/purchases-sdk').hasActiveEntitlement(info),
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
    // The store's own view is the default happy path: a purchase that went
    // through leaves an active entitlement on `customerInfo`.
    mockPurchasePackage.mockResolvedValue({ customerInfo: ENTITLED });
    mockRestorePurchases.mockResolvedValue(ENTITLED);
    mockGetCustomerInfo.mockResolvedValue(NOT_ENTITLED);
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
    await waitFor(() =>
      expect(result.current.notice).toBe(PURCHASE_CONFIRMED_NOTICE),
    );
  });

  // ---- 2.1(b): the App Review transcript ----

  /**
   * THE REJECTION, reproduced exactly.
   *
   * App Review buys in the sandbox. The API ignores sandbox events in
   * production on purpose (D10 — `checkEnvironment`, and `syncFromStore`'s
   * `wantedEnvironment` filter), so `POST /store/sync` answers
   * `{status:'noop',detail:'in_sync'}` for a purchase that WORKED. The screen
   * read that as "we could not confirm that yet" and showed it after the money
   * was taken; Apple rejected the build on that line.
   *
   * The store is now the authority on completion. This case fails against the
   * old code.
   */
  it('confirms the purchase when the store says so and the server answers in_sync', async () => {
    post.mockResolvedValue({ status: 'noop', detail: 'in_sync' });
    const { result } = await renderReady();

    await act(async () => result.current.purchase(MONTHLY));

    await waitFor(() =>
      expect(result.current.notice).toBe(PURCHASE_CONFIRMED_NOTICE),
    );
    // The reviewer must not be able to read failure into it, in any wording.
    expect(result.current.notice).not.toMatch(/could not|error|fail|sorry|problem/i);
    // And the server was still asked — it remains the authority on entitlement.
    expect(post).toHaveBeenCalledWith('/store/sync');
  });

  it('confirms on a sandbox purchase whatever the platform', async () => {
    // Play test-track purchases are reported as sandbox too, so nothing here
    // may key off `Platform.OS`. Same server answer, same outcome.
    post.mockResolvedValue({ status: 'noop', detail: 'in_sync' });
    const { result } = await renderReady();

    await act(async () => result.current.purchase(MONTHLY));

    await waitFor(() =>
      expect(result.current.notice).toBe(PURCHASE_CONFIRMED_NOTICE),
    );
  });

  it('confirms the purchase even when the server cannot be reached', async () => {
    // The store took the money and reports the entitlement. A server the client
    // could not reach says nothing about that.
    post.mockRejectedValue(new Error('network down'));
    const { result } = await renderReady();

    await act(async () => result.current.purchase(MONTHLY));

    await waitFor(() =>
      expect(result.current.notice).toBe(PURCHASE_CONFIRMED_NOTICE),
    );
  });

  it('confirms on the SERVER answer when the store reports nothing', async () => {
    // The other direction: no active entitlement on `customerInfo` yet, but the
    // server reconciled one. Either authority saying yes is enough.
    mockPurchasePackage.mockResolvedValue({ customerInfo: NOT_ENTITLED });
    post.mockResolvedValue({ status: 'processed' });
    const { result } = await renderReady();

    await act(async () => result.current.purchase(MONTHLY));

    await waitFor(() =>
      expect(result.current.notice).toBe(PURCHASE_CONFIRMED_NOTICE),
    );
  });

  it('reports a failure only when NEITHER the store nor the server has it', async () => {
    mockPurchasePackage.mockResolvedValue({ customerInfo: NOT_ENTITLED });
    post.mockResolvedValue({ status: 'noop', detail: 'in_sync' });
    const { result } = await renderReady();

    await act(async () => result.current.purchase(MONTHLY));

    await waitFor(() =>
      expect(result.current.notice).toBe(PURCHASE_FAILED_NOTICE),
    );
  });

  it('survives a customerInfo with no entitlements block at all', async () => {
    // `CustomerInfo` crosses a native bridge; a partial object must read as
    // "not entitled", never throw. The old mock returned exactly this.
    mockPurchasePackage.mockResolvedValue({ customerInfo: {} });
    post.mockResolvedValue({ status: 'noop', detail: 'in_sync' });
    const { result } = await renderReady();

    await act(async () => result.current.purchase(MONTHLY));

    await waitFor(() =>
      expect(result.current.notice).toBe(PURCHASE_FAILED_NOTICE),
    );
  });

  // ---- A rejection is not proof of failure ----

  /**
   * Tapping a plan you already own makes the SDK throw
   * PRODUCT_ALREADY_PURCHASED. The old code rendered that as the unconfirmed
   * line; rendering it as a failure would be worse. We ask the STORE who owns
   * this instead — never the error code, never its message text, both of which
   * differ per platform and per SDK version.
   */
  it('confirms when the purchase throws but the store reports an entitlement', async () => {
    mockPurchasePackage.mockRejectedValue(new Error('PRODUCT_ALREADY_PURCHASED'));
    mockGetCustomerInfo.mockResolvedValue(ENTITLED);
    post.mockResolvedValue({ status: 'noop', detail: 'in_sync' });
    const { result } = await renderReady();

    await act(async () => result.current.purchase(MONTHLY));

    await waitFor(() =>
      expect(result.current.notice).toBe(PURCHASE_CONFIRMED_NOTICE),
    );
    expect(mockGetCustomerInfo).toHaveBeenCalledTimes(1);
    // Still reconciled, so the entitlement the server serves catches up.
    expect(post).toHaveBeenCalledWith('/store/sync');
  });

  it('reports a failure when the purchase throws and the store has nothing', async () => {
    mockPurchasePackage.mockRejectedValue(new Error('store down'));
    mockGetCustomerInfo.mockResolvedValue(NOT_ENTITLED);
    const { result } = await renderReady();

    await act(async () => result.current.purchase(MONTHLY));

    await waitFor(() =>
      expect(result.current.notice).toBe(PURCHASE_FAILED_NOTICE),
    );
  });

  it('reports a failure when even getCustomerInfo throws', async () => {
    // Nothing left to ask. It must fall through to the failure line, not crash
    // the screen with an unhandled rejection.
    mockPurchasePackage.mockRejectedValue(new Error('store down'));
    mockGetCustomerInfo.mockRejectedValue(new Error('bridge gone'));
    const { result } = await renderReady();

    await act(async () => result.current.purchase(MONTHLY));

    await waitFor(() =>
      expect(result.current.notice).toBe(PURCHASE_FAILED_NOTICE),
    );
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it('says nothing at all when the user dismisses the store sheet', async () => {
    // A cancelled purchase is not a failure and gets no message — and it must
    // not go asking the store about an entitlement nobody tried to buy.
    mockPurchasePackage.mockRejectedValue({ userCancelled: true });
    const { result } = await renderReady();

    await act(async () => result.current.purchase(MONTHLY));

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.notice).toBeNull();
    expect(mockGetCustomerInfo).not.toHaveBeenCalled();
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
    await waitFor(() =>
      expect(result.current.notice).toBe(RESTORE_CONFIRMED_NOTICE),
    );
  });

  /**
   * The restore half of the 2.1(b) transcript. A reviewer who taps Restore
   * after buying gets the same sandbox-ignoring `in_sync` answer, and used to
   * be told there was nothing on their store account — about a purchase they
   * had just made. Fails against the old code.
   */
  it('confirms the restore when the store has it and the server answers in_sync', async () => {
    post.mockResolvedValue({ status: 'noop', detail: 'in_sync' });
    const { result } = await renderReady();

    await act(async () => result.current.restore());

    await waitFor(() =>
      expect(result.current.notice).toBe(RESTORE_CONFIRMED_NOTICE),
    );
    expect(result.current.notice).not.toMatch(/could not|error|fail|sorry|problem/i);
  });

  it('says nothing was restored, neutrally, when neither side has anything', async () => {
    mockRestorePurchases.mockResolvedValue(NOT_ENTITLED);
    post.mockResolvedValue({ status: 'noop', detail: 'in_sync' });
    const { result } = await renderReady();

    await act(async () => result.current.restore());

    await waitFor(() => expect(result.current.notice).toBe(RESTORE_NOTHING_NOTICE));
    // Names no other account and no plan — §7's rule for the "already in use"
    // case, applied to every empty restore.
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
