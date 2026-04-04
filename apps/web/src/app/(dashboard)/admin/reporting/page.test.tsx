import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mutable mock data ──────────────────────────────────────

let mockRevenueSummary: { data: unknown; isLoading: boolean } = { data: null, isLoading: false };
let mockRevenueTrend: { data: unknown; isLoading: boolean } = { data: null, isLoading: false };
let mockRevenueByPlan: { data: unknown; isLoading: boolean } = { data: null, isLoading: false };
let mockSubscriptionSummary: { data: unknown; isLoading: boolean } = { data: null, isLoading: false };
let mockSubscriptionTrend: { data: unknown; isLoading: boolean } = { data: null, isLoading: false };
let mockSubscriptionDistribution: { data: unknown; isLoading: boolean } = { data: null, isLoading: false };
let mockTrialSummary: { data: unknown; isLoading: boolean } = { data: null, isLoading: false };
let mockPaymentSummary: { data: unknown; isLoading: boolean } = { data: null, isLoading: false };
let mockPaymentTrend: { data: unknown; isLoading: boolean } = { data: null, isLoading: false };
let mockDiscountSummary: { data: unknown; isLoading: boolean } = { data: null, isLoading: false };
let mockTopCoupons: { data: unknown; isLoading: boolean } = { data: null, isLoading: false };
let mockTopPromotions: { data: unknown; isLoading: boolean } = { data: null, isLoading: false };
let mockCustomerSummary: { data: unknown; isLoading: boolean } = { data: null, isLoading: false };

vi.mock('@/features/billing/hooks/use-admin-reporting', () => ({
  useRevenueSummary: () => mockRevenueSummary,
  useRevenueTrend: () => mockRevenueTrend,
  useRevenueByPlan: () => mockRevenueByPlan,
  useSubscriptionSummary: () => mockSubscriptionSummary,
  useSubscriptionTrend: () => mockSubscriptionTrend,
  useSubscriptionDistribution: () => mockSubscriptionDistribution,
  useTrialSummary: () => mockTrialSummary,
  usePaymentSummary: () => mockPaymentSummary,
  usePaymentTrend: () => mockPaymentTrend,
  useDiscountSummary: () => mockDiscountSummary,
  useTopCoupons: () => mockTopCoupons,
  useTopPromotions: () => mockTopPromotions,
  useCustomerSummary: () => mockCustomerSummary,
}));

// Mock chart components — d3 does not render in happy-dom
vi.mock('@/components/charts/line-chart', () => ({
  LineChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="line-chart">LineChart ({data.length} points)</div>
  ),
}));

vi.mock('@/components/charts/bar-chart', () => ({
  BarChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="bar-chart">BarChart ({data.length} items)</div>
  ),
}));

// Mock skeleton
vi.mock('@/components/ui/skeleton', () => ({
  AdminCardSkeleton: () => <div data-testid="admin-skeleton">Loading...</div>,
}));

import ReportingPage from './page';

// ─── Test Data Factories ────────────────────────────────────

const revenueSummaryData = {
  mrrCentavos: 1000000,
  mrrPesos: 10000,
  arrCentavos: 12000000,
  arrPesos: 120000,
  arpuCentavos: 50000,
  arpuPesos: 500,
  netRevenueCentavos: 900000,
  netRevenuePesos: 9000,
  totalDiscountsCentavos: 100000,
  totalDiscountsPesos: 1000,
  activeSubscriptions: 20,
};

const revenueTrendData = {
  data: [
    { period: '2026-01-01', revenueCentavos: 50000, revenuePesos: 500, paymentCount: 5 },
    { period: '2026-02-01', revenueCentavos: 60000, revenuePesos: 600, paymentCount: 6 },
  ],
  periodType: 'month',
  startDate: '2026-01-01',
  endDate: '2026-03-31',
};

const revenueByPlanData = {
  data: [
    { planCode: 'pro', planName: 'Pro', revenueCentavos: 99900, revenuePesos: 999, paymentCount: 1, subscriptionCount: 1 },
    { planCode: 'team', planName: 'Team', revenueCentavos: 249900, revenuePesos: 2499, paymentCount: 2, subscriptionCount: 2 },
  ],
  totalRevenueCentavos: 349800,
  totalRevenuePesos: 3498,
};

const subscriptionSummaryData = {
  totalActive: 50,
  activePaid: 30,
  activeTrial: 10,
  newInPeriod: 5,
  cancelledInPeriod: 2,
  churnRate: 0.04,
  netGrowth: 3,
};

const subscriptionDistributionData = {
  byPlan: [
    { label: 'pro', count: 20 },
    { label: 'team', count: 10 },
  ],
  byStatus: [
    { label: 'active', count: 30 },
    { label: 'cancelled', count: 5 },
  ],
  byBillingPeriod: [
    { label: 'monthly', count: 25 },
    { label: 'annual', count: 10 },
  ],
};

const trialSummaryData = {
  totalTrials: 20,
  activeTrials: 5,
  convertedTrials: 10,
  expiredTrials: 3,
  cancelledTrials: 2,
  conversionRate: 0.5,
  avgTrialDurationDays: 7.5,
};

const paymentSummaryData = {
  totalSucceeded: 100,
  totalFailed: 5,
  totalPending: 2,
  totalRefunded: 1,
  successRate: 0.95,
  totalAmountCentavos: 5000000,
  totalAmountPesos: 50000,
  avgTransactionCentavos: 50000,
  avgTransactionPesos: 500,
};

const discountSummaryData = {
  totalCouponRedemptions: 15,
  couponDiscountCentavos: 150000,
  couponDiscountPesos: 1500,
  totalPromotionRedemptions: 8,
  promotionDiscountCentavos: 80000,
  promotionDiscountPesos: 800,
  totalDiscountCentavos: 230000,
  totalDiscountPesos: 2300,
  discountToRevenueRatio: 0.05,
};

const topCouponsData = [
  { couponId: 'c1', code: 'SAVE20', name: 'Save 20%', redemptionCount: 50, totalDiscountCentavos: 500000, totalDiscountPesos: 5000 },
];

const topPromotionsData = [
  { promotionId: 'p1', name: 'Summer Sale', slug: 'summer-sale', redemptionCount: 30, totalDiscountCentavos: 300000, totalDiscountPesos: 3000 },
];

const customerSummaryData = {
  totalOrganizations: 100,
  byType: [
    { label: 'individual', count: 60 },
    { label: 'firm', count: 25 },
    { label: 'school', count: 15 },
  ],
  newSignupsInPeriod: 12,
  totalSeats: 200,
  usedSeats: 150,
  seatUtilization: 0.75,
};

// ─── Helpers ────────────────────────────────────────────────

function resetAllMocks() {
  mockRevenueSummary = { data: null, isLoading: false };
  mockRevenueTrend = { data: null, isLoading: false };
  mockRevenueByPlan = { data: null, isLoading: false };
  mockSubscriptionSummary = { data: null, isLoading: false };
  mockSubscriptionTrend = { data: null, isLoading: false };
  mockSubscriptionDistribution = { data: null, isLoading: false };
  mockTrialSummary = { data: null, isLoading: false };
  mockPaymentSummary = { data: null, isLoading: false };
  mockPaymentTrend = { data: null, isLoading: false };
  mockDiscountSummary = { data: null, isLoading: false };
  mockTopCoupons = { data: null, isLoading: false };
  mockTopPromotions = { data: null, isLoading: false };
  mockCustomerSummary = { data: null, isLoading: false };
}

// ─── Tests ──────────────────────────────────────────────────

describe('ReportingPage', () => {
  beforeEach(() => {
    resetAllMocks();
    vi.clearAllMocks();
  });

  // ─── Page Layout ───────────────────────────────────────

  describe('page layout', () => {
    it('renders heading and description', () => {
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: revenueTrendData, isLoading: false };
      mockRevenueByPlan = { data: revenueByPlanData, isLoading: false };

      render(<ReportingPage />);

      expect(screen.getByText('Reporting & Analytics')).toBeInTheDocument();
      expect(
        screen.getByText('Business metrics, revenue analytics, and subscription health'),
      ).toBeInTheDocument();
    });

    it('renders all 6 tab triggers', () => {
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: revenueTrendData, isLoading: false };
      mockRevenueByPlan = { data: revenueByPlanData, isLoading: false };

      render(<ReportingPage />);

      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(6);
      expect(tabs[0]).toHaveTextContent('Revenue');
      expect(tabs[1]).toHaveTextContent('Subscriptions');
      expect(tabs[2]).toHaveTextContent('Trials');
      expect(tabs[3]).toHaveTextContent('Payments');
      expect(tabs[4]).toHaveTextContent('Discounts');
      expect(tabs[5]).toHaveTextContent('Customers');
    });

    it('defaults to the Revenue tab', () => {
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: revenueTrendData, isLoading: false };
      mockRevenueByPlan = { data: revenueByPlanData, isLoading: false };

      render(<ReportingPage />);

      // Revenue tab content should be visible (MRR metric)
      expect(screen.getByText('MRR')).toBeInTheDocument();
    });
  });

  // ─── Revenue Tab ───────────────────────────────────────

  describe('Revenue tab', () => {
    it('shows skeleton when loading', () => {
      mockRevenueSummary = { data: null, isLoading: true };

      render(<ReportingPage />);

      expect(screen.getByTestId('admin-skeleton')).toBeInTheDocument();
    });

    it('displays revenue metric cards with formatted values', () => {
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: revenueTrendData, isLoading: false };
      mockRevenueByPlan = { data: revenueByPlanData, isLoading: false };

      render(<ReportingPage />);

      expect(screen.getByText('MRR')).toBeInTheDocument();
      expect(screen.getByText('ARR')).toBeInTheDocument();
      expect(screen.getByText('ARPU')).toBeInTheDocument();
      expect(screen.getByText('Net Revenue')).toBeInTheDocument();
      // Sub-label under ARPU
      expect(screen.getByText('20 active subs')).toBeInTheDocument();
    });

    it('renders revenue trend chart with data points', () => {
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: revenueTrendData, isLoading: false };
      mockRevenueByPlan = { data: revenueByPlanData, isLoading: false };

      render(<ReportingPage />);

      expect(screen.getByText('Revenue Trend')).toBeInTheDocument();
      expect(screen.getByText('LineChart (2 points)')).toBeInTheDocument();
    });

    it('renders revenue by plan bar chart', () => {
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: revenueTrendData, isLoading: false };
      mockRevenueByPlan = { data: revenueByPlanData, isLoading: false };

      render(<ReportingPage />);

      expect(screen.getByText('Revenue by Plan')).toBeInTheDocument();
      expect(screen.getByText('BarChart (2 items)')).toBeInTheDocument();
    });

    it('shows detail table for revenue by plan', () => {
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: revenueTrendData, isLoading: false };
      mockRevenueByPlan = { data: revenueByPlanData, isLoading: false };

      render(<ReportingPage />);

      expect(screen.getByText('Revenue by Plan (Detail)')).toBeInTheDocument();
      // Plan names in the detail table rows
      const allPro = screen.getAllByText('Pro');
      expect(allPro.length).toBeGreaterThanOrEqual(1);
      const allTeam = screen.getAllByText('Team');
      expect(allTeam.length).toBeGreaterThanOrEqual(1);
    });

    it('shows "No trend data" when no trend data available', () => {
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: { data: [] }, isLoading: false };
      mockRevenueByPlan = { data: { data: [] }, isLoading: false };

      render(<ReportingPage />);

      expect(screen.getByText('No trend data')).toBeInTheDocument();
    });
  });

  // ─── Subscriptions Tab ─────────────────────────────────

  describe('Subscriptions tab', () => {
    it('shows subscription metrics when tab is clicked', async () => {
      // Revenue tab loads first
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: revenueTrendData, isLoading: false };
      mockRevenueByPlan = { data: revenueByPlanData, isLoading: false };
      // Subscriptions tab data
      mockSubscriptionSummary = { data: subscriptionSummaryData, isLoading: false };
      mockSubscriptionTrend = { data: { data: [] }, isLoading: false };
      mockSubscriptionDistribution = { data: subscriptionDistributionData, isLoading: false };

      render(<ReportingPage />);

      const user = userEvent.setup();
      const tabs = screen.getAllByRole('tab');
      await user.click(tabs[1]!); // Subscriptions tab

      expect(screen.getByText('Total Active')).toBeInTheDocument();
      expect(screen.getByText('Churn Rate')).toBeInTheDocument();
      expect(screen.getByText('30 paid, 10 trial')).toBeInTheDocument();
    });

    it('shows distribution lists', async () => {
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: revenueTrendData, isLoading: false };
      mockRevenueByPlan = { data: revenueByPlanData, isLoading: false };
      mockSubscriptionSummary = { data: subscriptionSummaryData, isLoading: false };
      mockSubscriptionTrend = { data: { data: [] }, isLoading: false };
      mockSubscriptionDistribution = { data: subscriptionDistributionData, isLoading: false };

      render(<ReportingPage />);

      const user = userEvent.setup();
      const tabs = screen.getAllByRole('tab');
      await user.click(tabs[1]!); // Subscriptions tab

      expect(screen.getByText('By Plan')).toBeInTheDocument();
      expect(screen.getByText('By Status')).toBeInTheDocument();
      expect(screen.getByText('By Billing Period')).toBeInTheDocument();
    });
  });

  // ─── Trials Tab ────────────────────────────────────────

  describe('Trials tab', () => {
    it('shows trial funnel metrics', async () => {
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: revenueTrendData, isLoading: false };
      mockRevenueByPlan = { data: revenueByPlanData, isLoading: false };
      mockTrialSummary = { data: trialSummaryData, isLoading: false };

      render(<ReportingPage />);

      const user = userEvent.setup();
      const tabs = screen.getAllByRole('tab');
      await user.click(tabs[2]!); // Trials tab

      expect(screen.getByText('Total Trials')).toBeInTheDocument();
      expect(screen.getByText('Conversion Rate')).toBeInTheDocument();
      expect(screen.getByText('Avg Duration')).toBeInTheDocument();
      expect(screen.getByText('5 active now')).toBeInTheDocument();
    });

    it('shows trial funnel card with counts', async () => {
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: revenueTrendData, isLoading: false };
      mockRevenueByPlan = { data: revenueByPlanData, isLoading: false };
      mockTrialSummary = { data: trialSummaryData, isLoading: false };

      render(<ReportingPage />);

      const user = userEvent.setup();
      const tabs = screen.getAllByRole('tab');
      await user.click(tabs[2]!); // Trials tab

      expect(screen.getByText('Trial Funnel')).toBeInTheDocument();
      expect(screen.getByText('Started')).toBeInTheDocument();
      // "Converted" appears in metric card and funnel
      const converted = screen.getAllByText('Converted');
      expect(converted.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Expired')).toBeInTheDocument();
      // "Cancelled" may appear in metric card and funnel
      const cancelled = screen.getAllByText('Cancelled');
      expect(cancelled.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Payments Tab ──────────────────────────────────────

  describe('Payments tab', () => {
    it('shows payment metrics and status breakdown', async () => {
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: revenueTrendData, isLoading: false };
      mockRevenueByPlan = { data: revenueByPlanData, isLoading: false };
      mockPaymentSummary = { data: paymentSummaryData, isLoading: false };
      mockPaymentTrend = { data: { data: [] }, isLoading: false };

      render(<ReportingPage />);

      const user = userEvent.setup();
      const tabs = screen.getAllByRole('tab');
      await user.click(tabs[3]!); // Payments tab

      expect(screen.getByText('Total Revenue')).toBeInTheDocument();
      expect(screen.getByText('Success Rate')).toBeInTheDocument();
      expect(screen.getByText('Avg Transaction')).toBeInTheDocument();
      // "Succeeded" appears in metric card label AND status breakdown
      const succeeded = screen.getAllByText('Succeeded');
      expect(succeeded.length).toBeGreaterThanOrEqual(1);
    });

    it('shows payment status breakdown card', async () => {
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: revenueTrendData, isLoading: false };
      mockRevenueByPlan = { data: revenueByPlanData, isLoading: false };
      mockPaymentSummary = { data: paymentSummaryData, isLoading: false };
      mockPaymentTrend = { data: { data: [] }, isLoading: false };

      render(<ReportingPage />);

      const user = userEvent.setup();
      const tabs = screen.getAllByRole('tab');
      await user.click(tabs[3]!); // Payments tab

      expect(screen.getByText('Payment Status Breakdown')).toBeInTheDocument();
      expect(screen.getByText('Failed')).toBeInTheDocument();
      expect(screen.getByText('Pending')).toBeInTheDocument();
      expect(screen.getByText('Refunded')).toBeInTheDocument();
    });
  });

  // ─── Discounts Tab ─────────────────────────────────────

  describe('Discounts tab', () => {
    it('shows discount metrics', async () => {
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: revenueTrendData, isLoading: false };
      mockRevenueByPlan = { data: revenueByPlanData, isLoading: false };
      mockDiscountSummary = { data: discountSummaryData, isLoading: false };
      mockTopCoupons = { data: topCouponsData, isLoading: false };
      mockTopPromotions = { data: topPromotionsData, isLoading: false };

      render(<ReportingPage />);

      const user = userEvent.setup();
      const tabs = screen.getAllByRole('tab');
      await user.click(tabs[4]!); // Discounts tab

      expect(screen.getByText('Total Discounts')).toBeInTheDocument();
      expect(screen.getByText('Coupon Discounts')).toBeInTheDocument();
      expect(screen.getByText('Promotion Discounts')).toBeInTheDocument();
      expect(screen.getByText('Discount/Revenue')).toBeInTheDocument();
      expect(screen.getByText('15 redemptions')).toBeInTheDocument();
    });

    it('shows top coupons table', async () => {
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: revenueTrendData, isLoading: false };
      mockRevenueByPlan = { data: revenueByPlanData, isLoading: false };
      mockDiscountSummary = { data: discountSummaryData, isLoading: false };
      mockTopCoupons = { data: topCouponsData, isLoading: false };
      mockTopPromotions = { data: topPromotionsData, isLoading: false };

      render(<ReportingPage />);

      const user = userEvent.setup();
      const tabs = screen.getAllByRole('tab');
      await user.click(tabs[4]!); // Discounts tab

      expect(screen.getByText('Top Coupons')).toBeInTheDocument();
      expect(screen.getByText('SAVE20')).toBeInTheDocument();
      expect(screen.getByText('Save 20%')).toBeInTheDocument();
    });

    it('shows top promotions table', async () => {
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: revenueTrendData, isLoading: false };
      mockRevenueByPlan = { data: revenueByPlanData, isLoading: false };
      mockDiscountSummary = { data: discountSummaryData, isLoading: false };
      mockTopCoupons = { data: topCouponsData, isLoading: false };
      mockTopPromotions = { data: topPromotionsData, isLoading: false };

      render(<ReportingPage />);

      const user = userEvent.setup();
      const tabs = screen.getAllByRole('tab');
      await user.click(tabs[4]!); // Discounts tab

      expect(screen.getByText('Top Promotions')).toBeInTheDocument();
      expect(screen.getByText('Summer Sale')).toBeInTheDocument();
      expect(screen.getByText('summer-sale')).toBeInTheDocument();
    });

    it('shows "No coupon data" when no coupons', async () => {
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: revenueTrendData, isLoading: false };
      mockRevenueByPlan = { data: revenueByPlanData, isLoading: false };
      mockDiscountSummary = { data: discountSummaryData, isLoading: false };
      mockTopCoupons = { data: [], isLoading: false };
      mockTopPromotions = { data: [], isLoading: false };

      render(<ReportingPage />);

      const user = userEvent.setup();
      const tabs = screen.getAllByRole('tab');
      await user.click(tabs[4]!); // Discounts tab

      expect(screen.getByText('No coupon data')).toBeInTheDocument();
      expect(screen.getByText('No promotion data')).toBeInTheDocument();
    });
  });

  // ─── Customers Tab ─────────────────────────────────────

  describe('Customers tab', () => {
    it('shows customer metrics', async () => {
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: revenueTrendData, isLoading: false };
      mockRevenueByPlan = { data: revenueByPlanData, isLoading: false };
      mockCustomerSummary = { data: customerSummaryData, isLoading: false };

      render(<ReportingPage />);

      const user = userEvent.setup();
      const tabs = screen.getAllByRole('tab');
      await user.click(tabs[5]!); // Customers tab

      expect(screen.getByText('Total Organizations')).toBeInTheDocument();
      expect(screen.getByText('New Signups')).toBeInTheDocument();
      // "Seat Utilization" appears in metric card and card title
      const seatUtil = screen.getAllByText('Seat Utilization');
      expect(seatUtil.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Seats Available')).toBeInTheDocument();
    });

    it('shows organization type distribution', async () => {
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: revenueTrendData, isLoading: false };
      mockRevenueByPlan = { data: revenueByPlanData, isLoading: false };
      mockCustomerSummary = { data: customerSummaryData, isLoading: false };

      render(<ReportingPage />);

      const user = userEvent.setup();
      const tabs = screen.getAllByRole('tab');
      await user.click(tabs[5]!); // Customers tab

      expect(screen.getByText('Organizations by Type')).toBeInTheDocument();
      expect(screen.getByText('individual')).toBeInTheDocument();
      expect(screen.getByText('firm')).toBeInTheDocument();
      expect(screen.getByText('school')).toBeInTheDocument();
    });

    it('shows seat utilization card', async () => {
      mockRevenueSummary = { data: revenueSummaryData, isLoading: false };
      mockRevenueTrend = { data: revenueTrendData, isLoading: false };
      mockRevenueByPlan = { data: revenueByPlanData, isLoading: false };
      mockCustomerSummary = { data: customerSummaryData, isLoading: false };

      render(<ReportingPage />);

      const user = userEvent.setup();
      const tabs = screen.getAllByRole('tab');
      await user.click(tabs[5]!); // Customers tab

      expect(screen.getByText('Used Seats')).toBeInTheDocument();
      expect(screen.getByText('Total Seats')).toBeInTheDocument();
      expect(screen.getByText('150 / 200 seats')).toBeInTheDocument();
    });
  });
});
