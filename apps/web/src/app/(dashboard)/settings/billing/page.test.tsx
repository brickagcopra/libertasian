import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * Billing Settings Page — recurring-subscription UI.
 * Covers the dunning banner (past_due / grace_period), auto-renew vs.
 * cancel-at-period-end period copy, and the payment-method removal guard.
 * Hooks are mocked so the page renders without a live QueryClient / API.
 */

// Mutable fixtures — reset in beforeEach, varied per test.
type Sub = {
  planCode: string;
  status: string;
  billingPeriod: string;
  currentPeriodEnd: string | null;
  seats: number;
  cancelAtPeriodEnd: boolean;
} | null;

let mockSubscription: Sub = null;
let mockMethods: Array<Record<string, unknown>> = [];

vi.mock('@/features/billing/hooks/use-subscription', () => ({
  useSubscription: () => ({ data: mockSubscription, isLoading: false }),
  meetsMinimumTier: () => false,
}));

vi.mock('@/features/billing/hooks/use-plans', () => ({
  usePlanInfoList: () => ({ plans: [], isLoading: false }),
}));

const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });

vi.mock('@/features/billing/hooks/use-billing', () => ({
  useCreateCheckout: () => mutation(),
  useCheckoutPreview: () => mutation(),
  useValidateCoupon: () => mutation(),
  useEligiblePromotions: () => mutation(),
  useCancelSubscription: () => mutation(),
  usePaymentMethods: () => ({ data: mockMethods, isLoading: false, error: null }),
  useSetDefaultPaymentMethod: () => mutation(),
  useDeletePaymentMethod: () => mutation(),
  useInvoices: () => ({
    data: { data: [], meta: { hasNext: false } },
    isLoading: false,
    error: null,
  }),
}));

import BillingPage from './page';

const activeSub: NonNullable<Sub> = {
  planCode: 'pro',
  status: 'active',
  billingPeriod: 'monthly',
  currentPeriodEnd: '2026-07-15T00:00:00Z',
  seats: 1,
  cancelAtPeriodEnd: false,
};

const cardMethod = {
  id: 'pm-1',
  type: 'card',
  brand: 'visa',
  last4: '4242',
  expiryMonth: 12,
  expiryYear: 2029,
  billingEmail: null,
  isDefault: true,
  isActive: true,
  createdAt: '2026-06-01T00:00:00Z',
};

const bannerText = /process your latest payment/i;

describe('BillingPage — recurring subscription UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscription = null;
    mockMethods = [];
  });

  describe('dunning banner', () => {
    it('shows the dunning banner when status is past_due', () => {
      mockSubscription = { ...activeSub, status: 'past_due' };
      render(<BillingPage />);
      expect(screen.getByText(bannerText)).toBeInTheDocument();
    });

    it('shows the dunning banner when status is grace_period', () => {
      mockSubscription = { ...activeSub, status: 'grace_period' };
      render(<BillingPage />);
      expect(screen.getByText(bannerText)).toBeInTheDocument();
    });

    it('hides the dunning banner when status is active', () => {
      mockSubscription = { ...activeSub };
      render(<BillingPage />);
      expect(screen.queryByText(bannerText)).not.toBeInTheDocument();
    });

    it('still renders the plan card (not "no subscription") while past_due', () => {
      mockSubscription = { ...activeSub, status: 'past_due' };
      render(<BillingPage />);
      // Plan name + a dunning badge render alongside the banner.
      expect(screen.getByText('Pro')).toBeInTheDocument();
      expect(screen.getByText('Past due')).toBeInTheDocument();
    });
  });

  describe('period-end copy', () => {
    it('shows auto-renew copy for an active, non-cancelling subscription', () => {
      mockSubscription = { ...activeSub };
      render(<BillingPage />);
      expect(screen.getByText(/renews automatically on/i)).toBeInTheDocument();
      expect(screen.queryByText(/won.t renew/i)).not.toBeInTheDocument();
    });

    it('switches to end-of-access copy when cancelAtPeriodEnd is set', () => {
      mockSubscription = { ...activeSub, cancelAtPeriodEnd: true };
      render(<BillingPage />);
      expect(screen.getByText(/won.t renew/i)).toBeInTheDocument();
      expect(screen.getByText(/subscribe again/i)).toBeInTheDocument();
      expect(screen.queryByText(/renews automatically on/i)).not.toBeInTheDocument();
    });
  });

  describe('payment method removal guard', () => {
    it('disables Remove for the method backing an active subscription', () => {
      mockSubscription = { ...activeSub };
      mockMethods = [cardMethod];
      render(<BillingPage />);
      expect(screen.getByRole('button', { name: /remove/i })).toBeDisabled();
    });

    it('renders the card method label cleanly', () => {
      mockSubscription = { ...activeSub };
      mockMethods = [cardMethod];
      render(<BillingPage />);
      expect(screen.getByText(/visa ending in 4242/i)).toBeInTheDocument();
    });

    it('renders an e-wallet method label cleanly', () => {
      mockSubscription = { ...activeSub };
      mockMethods = [
        { ...cardMethod, type: 'gcash', brand: null, last4: null, expiryMonth: null, expiryYear: null },
      ];
      render(<BillingPage />);
      expect(screen.getByText('GCash')).toBeInTheDocument();
    });
  });
});
