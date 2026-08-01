import React from 'react';
import { Linking } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    setOnUnauthorized: jest.fn(),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

import { router } from 'expo-router';
import { apiClient } from '@/lib/api-client';
import PlansScreen from '@/app/settings/plans';
import type { SubscriptionDetail } from '@/features/billing/types';

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockCanGoBack = router.canGoBack as jest.MockedFunction<typeof router.canGoBack>;

function subscriptionOn(planCode: string): SubscriptionDetail {
  return {
    id: 'sub1',
    planCode,
    status: 'active',
    billingPeriod: 'monthly',
    currentPeriodStart: null,
    currentPeriodEnd: null,
    seats: 1,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    trialStart: null,
    trialEnd: null,
    createdAt: '2024-01-15T00:00:00Z',
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

/**
 * This screen used to list every plan with prices and open a Xendit checkout
 * in the system browser. Apple Guideline 3.1.1 and Google Play's Payments
 * policy forbid that, and forbid steering users to an external purchase, so
 * the screen is now a read-only view of the plan the account already has.
 *
 * Most of these tests assert ABSENCE. That is deliberate: a regression here
 * is a store rejection on an already-submitted binary, not a cosmetic bug.
 */
describe('PlansScreen — read-only current plan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanGoBack.mockReturnValue(false);
    mockGet.mockImplementation((url: string) => {
      if (url === '/plans') return Promise.resolve({ success: true, data: [] });
      if (url === '/billing/subscription') {
        return Promise.resolve(subscriptionOn('free'));
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
  });

  function renderScreen() {
    return render(<PlansScreen />, { wrapper: createWrapper() });
  }

  describe('what it shows', () => {
    it("renders the account's current plan name", async () => {
      const utils = renderScreen();

      await waitFor(() => expect(utils.getByText('Free')).toBeTruthy());
      expect(utils.getByText('Current plan')).toBeTruthy();
    });

    it('lists what the current plan includes', async () => {
      const utils = renderScreen();

      await waitFor(() => expect(utils.getByText("What's included")).toBeTruthy());
    });

    it('reflects a paid plan without offering to change it', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url === '/plans') return Promise.resolve({ success: true, data: [] });
        if (url === '/billing/subscription') {
          return Promise.resolve(subscriptionOn('pro'));
        }
        return Promise.reject(new Error(`Unexpected GET ${url}`));
      });

      const utils = renderScreen();

      await waitFor(() => expect(utils.getByText('Pro')).toBeTruthy());
      expect(utils.queryByText('Free')).toBeNull();
      expect(utils.queryByText('Downgrade')).toBeNull();
    });
  });

  describe('what it must never show (Apple 3.1.1 / Play Payments)', () => {
    it('shows no price for any plan', async () => {
      const utils = renderScreen();

      await waitFor(() => expect(utils.getByText('Free')).toBeTruthy());

      // "Free" is the plan NAME here, not a price. Nothing may carry a peso
      // amount or a billing period.
      expect(utils.queryByText(/₱/)).toBeNull();
      expect(utils.queryByText(/\/mo/)).toBeNull();
      expect(utils.queryByText(/\/yr/)).toBeNull();
    });

    it('offers no purchase or plan-change CTA', async () => {
      const utils = renderScreen();

      await waitFor(() => expect(utils.getByText('Free')).toBeTruthy());

      expect(utils.queryByText('Upgrade')).toBeNull();
      expect(utils.queryByText('Downgrade')).toBeNull();
      expect(utils.queryByText('Subscribe')).toBeNull();
      expect(utils.queryByText('Proceed to Payment')).toBeNull();
    });

    it('has no billing-period toggle and no coupon field', async () => {
      const utils = renderScreen();

      await waitFor(() => expect(utils.getByText('Free')).toBeTruthy());

      expect(utils.queryByText('Monthly')).toBeNull();
      expect(utils.queryByText('Annual')).toBeNull();
      expect(utils.queryByText('Save ~17%')).toBeNull();
      expect(utils.queryByLabelText('Coupon code')).toBeNull();
      expect(utils.queryByText('Apply')).toBeNull();
    });

    it('never opens an external URL', async () => {
      const utils = renderScreen();

      await waitFor(() => expect(utils.getByText('Free')).toBeTruthy());

      expect(Linking.openURL).not.toHaveBeenCalled();
    });

    it('never calls a checkout, coupon or promotion endpoint', async () => {
      const utils = renderScreen();

      await waitFor(() => expect(utils.getByText('Free')).toBeTruthy());

      expect(mockPost).not.toHaveBeenCalled();
      const requested = mockGet.mock.calls.map((c) => c[0]);
      expect(requested).not.toContain('/promotions/active');
      expect(requested.some((u) => String(u).includes('checkout'))).toBe(false);
    });
  });
});
