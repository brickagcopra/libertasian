import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
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
import type { CheckoutPreviewData, SubscriptionDetail } from '@/features/billing/types';

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockCanGoBack = router.canGoBack as jest.MockedFunction<typeof router.canGoBack>;

const freeSubscription: SubscriptionDetail = {
  id: 'sub1',
  planCode: 'free',
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

const proPreview: CheckoutPreviewData = {
  basePriceAmount: 99900,
  couponId: null,
  couponCode: null,
  couponDiscountAmount: 0,
  promotionId: null,
  promotionDiscountAmount: 0,
  totalDiscountAmount: 0,
  finalAmount: 99900,
  currency: 'PHP',
  planCode: 'pro',
  billingPeriod: 'monthly',
  planName: 'Pro',
  planId: 'plan-pro',
  discountsStacked: false,
  lineItems: [],
  calculatedAt: '2026-07-09T00:00:00Z',
  currentPlanCode: 'free',
  isUpgrade: true,
  isDowngrade: false,
  isNewSubscription: true,
};

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

async function openProPreview(utils: ReturnType<typeof render>) {
  // Fallback PLANS order: free (no CTA), edu, pro, team, enterprise —
  // index 1 of the Upgrade buttons is the highlighted Pro card.
  const upgradeButtons = await waitFor(() => utils.getAllByText('Upgrade'));
  fireEvent.press(upgradeButtons[1]);
  await waitFor(() => utils.getByText('Upgrade to Pro'));
}

describe('PlansScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanGoBack.mockReturnValue(false);
    mockGet.mockImplementation((url: string) => {
      if (url === '/plans') return Promise.resolve({ success: true, data: [] });
      if (url === '/promotions/active') return Promise.resolve({ success: true, data: [] });
      if (url === '/billing/subscription') {
        return Promise.resolve({ success: true, data: freeSubscription });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    mockPost.mockImplementation((url: string) => {
      if (url === '/billing/checkout/preview') return Promise.resolve(proPreview);
      if (url === '/billing/checkout') {
        return Promise.resolve({
          checkoutUrl: 'https://checkout.xendit.co/web/session-1',
          checkoutSessionId: 'cs1',
          paymentId: 'p1',
        });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  it('renders the header and plan cards', async () => {
    const utils = render(<PlansScreen />, { wrapper: createWrapper() });

    expect(utils.getByText('Plans')).toBeTruthy();
    await waitFor(() => expect(utils.getByText('Pro')).toBeTruthy());
    expect(utils.getByText('Edu')).toBeTruthy();
    // "Free" appears as both the plan name and its zero price
    expect(utils.getAllByText('Free').length).toBeGreaterThanOrEqual(2);
    expect(utils.getByText('Most Popular')).toBeTruthy();
    expect(utils.getAllByText('Upgrade')).toHaveLength(4);
  });

  it('switches billing period via the toggle', async () => {
    const utils = render(<PlansScreen />, { wrapper: createWrapper() });
    await waitFor(() => expect(utils.getByText('Pro')).toBeTruthy());

    // Monthly by default — Pro shows its monthly price
    expect(utils.getByText('₱999')).toBeTruthy();

    fireEvent.press(utils.getByText('Annual'));
    expect(utils.getByText('₱9,990')).toBeTruthy();
    expect(utils.queryByText('₱999')).toBeNull();
  });

  it('opens the checkout preview modal when Upgrade is pressed', async () => {
    const utils = render(<PlansScreen />, { wrapper: createWrapper() });

    await openProPreview(utils);

    expect(mockPost).toHaveBeenCalledWith('/billing/checkout/preview', {
      planCode: 'pro',
      billingPeriod: 'monthly',
    });
    expect(utils.getByText('Base Price')).toBeTruthy();
    expect(utils.getByText('Total')).toBeTruthy();
    expect(utils.getByText('Proceed to Payment')).toBeTruthy();
  });

  it('confirming checkout posts the https bounce URLs and opens the browser', async () => {
    const utils = render(<PlansScreen />, { wrapper: createWrapper() });

    await openProPreview(utils);
    fireEvent.press(utils.getByText('Proceed to Payment'));

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/billing/checkout', {
        planCode: 'pro',
        billingPeriod: 'monthly',
        successUrl: 'https://libertasian.com/billing/mobile/success',
        cancelUrl: 'https://libertasian.com/billing/mobile/cancel',
      }),
    );
    await waitFor(() =>
      expect(Linking.openURL).toHaveBeenCalledWith(
        'https://checkout.xendit.co/web/session-1',
      ),
    );
  });

  it('back button falls back to /settings when there is no history', async () => {
    const utils = render(<PlansScreen />, { wrapper: createWrapper() });

    fireEvent.press(utils.getByLabelText('Go back'));

    expect(router.replace).toHaveBeenCalledWith('/settings');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('back button pops navigation history when available', async () => {
    mockCanGoBack.mockReturnValue(true);
    const utils = render(<PlansScreen />, { wrapper: createWrapper() });

    fireEvent.press(utils.getByLabelText('Go back'));

    expect(router.back).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
