import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { EffectiveEntitlementsPanel } from './effective-entitlements-panel';
import { apiClient } from '@/lib/api-client';

// Again: the apiClient is mocked, not the hook — the panel is exercised through
// the same envelope-unwrapping path the real page uses.
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
  },
}));

const SUB = 'sub-1';

function row(overrides: Record<string, unknown> = {}) {
  return {
    key: 'aiAnswers',
    planValue: 15,
    storedValue: 0,
    hasStoredValue: true,
    activeOverrides: [],
    effectiveValue: 0,
    winningLayer: 'subscription',
    conflictsWithPlan: true,
    ...overrides,
  };
}

function envelope(data: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      subscriptionId: SUB,
      organizationId: 'org-1',
      planCode: 'free',
      platform: 'web',
      paywallEnforced: true,
      isResolvedSubscription: true,
      resolvedSubscriptionId: SUB,
      keys: [row()],
      ...data,
    },
  };
}

function renderPanel() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <EffectiveEntitlementsPanel subscriptionId={SUB} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.get).mockResolvedValue(envelope());
  vi.mocked(apiClient.delete).mockResolvedValue({ success: true, data: {} });
});

describe('EffectiveEntitlementsPanel — layers', () => {
  it('shows plan, stored, effective and the winning layer for a key', async () => {
    renderPanel();

    const tr = await screen.findByTestId('entitlement-row-aiAnswers');
    expect(tr).toHaveTextContent('15'); // plan
    expect(tr).toHaveTextContent('Subscription'); // winning layer
  });

  it('renders -1 as "unlimited" rather than a raw sentinel', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(
      envelope({
        keys: [
          row({
            key: 'searchQueries',
            planValue: -1,
            storedValue: null,
            hasStoredValue: false,
            effectiveValue: -1,
            winningLayer: 'plan',
            conflictsWithPlan: false,
          }),
        ],
      }),
    );

    renderPanel();

    const tr = await screen.findByTestId('entitlement-row-searchQueries');
    expect(tr).toHaveTextContent('unlimited');
  });
});

describe('EffectiveEntitlementsPanel — conflict warning', () => {
  it('names both values on a conflicting row', async () => {
    renderPanel();

    const warning = await screen.findByTestId(
      'entitlement-conflict-aiAnswers',
    );
    expect(warning).toHaveTextContent('plan grants 15');
    expect(warning).toHaveTextContent('this subscription stores 0');
  });

  it('summarises how many keys conflict with the plan', async () => {
    renderPanel();

    expect(
      await screen.findByText(/contradicts the/i),
    ).toBeInTheDocument();
  });

  it('shows no warning when the stored value matches the plan', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(
      envelope({
        keys: [
          row({ storedValue: 15, effectiveValue: 15, conflictsWithPlan: false }),
        ],
      }),
    );

    renderPanel();

    await screen.findByTestId('entitlement-row-aiAnswers');
    expect(
      screen.queryByTestId('entitlement-conflict-aiAnswers'),
    ).not.toBeInTheDocument();
  });

  it('warns when the paywall is not enforced for the selected platform', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(
      envelope({ paywallEnforced: false }),
    );

    renderPanel();

    expect(
      await screen.findByText(/paywall is/i),
    ).toBeInTheDocument();
  });

  it('warns when the org resolves against a different subscription row', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(
      envelope({
        isResolvedSubscription: false,
        resolvedSubscriptionId: 'sub-newer',
      }),
    );

    renderPanel();

    expect(
      await screen.findByText(/resolves against a different subscription/i),
    ).toBeInTheDocument();
  });
});

describe('EffectiveEntitlementsPanel — platform switcher', () => {
  it('re-queries for the selected platform', async () => {
    renderPanel();

    await waitFor(() =>
      expect(apiClient.get).toHaveBeenCalledWith(
        `/admin/subscriptions/${SUB}/entitlements/effective?platform=web`,
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'iOS' }));

    await waitFor(() =>
      expect(apiClient.get).toHaveBeenCalledWith(
        `/admin/subscriptions/${SUB}/entitlements/effective?platform=ios`,
      ),
    );
  });

  it('marks the active platform', async () => {
    renderPanel();

    await screen.findByTestId('entitlement-row-aiAnswers');
    expect(screen.getByRole('button', { name: 'Web' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Android' }));

    expect(screen.getByRole('button', { name: 'Android' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('EffectiveEntitlementsPanel — Clear action', () => {
  it('confirms, then clears the stored key', async () => {
    renderPanel();

    await screen.findByTestId('entitlement-row-aiAnswers');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    // The dialog names the plan value the key will fall back to.
    expect(
      await screen.findByText(/Clear stored aiAnswers\?/i),
    ).toBeInTheDocument();

    const confirms = screen.getAllByRole('button', { name: 'Clear' });
    fireEvent.click(confirms[confirms.length - 1]);

    await waitFor(() =>
      expect(apiClient.delete).toHaveBeenCalledWith(
        `/admin/subscriptions/${SUB}/entitlements-json/aiAnswers`,
      ),
    );
  });

  it('offers no Clear on a key with no stored value', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(
      envelope({
        keys: [
          row({
            storedValue: null,
            hasStoredValue: false,
            effectiveValue: 15,
            winningLayer: 'plan',
            conflictsWithPlan: false,
          }),
        ],
      }),
    );

    renderPanel();

    await screen.findByTestId('entitlement-row-aiAnswers');
    expect(
      screen.queryByRole('button', { name: 'Clear' }),
    ).not.toBeInTheDocument();
  });

  it('filters to keys that carry a stored value or an override', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(
      envelope({
        keys: [
          row(),
          row({
            key: 'digestsPerMonth',
            storedValue: null,
            hasStoredValue: false,
            effectiveValue: 0,
            winningLayer: 'plan',
            conflictsWithPlan: false,
          }),
        ],
      }),
    );

    renderPanel();

    await screen.findByTestId('entitlement-row-digestsPerMonth');
    fireEvent.click(
      screen.getByLabelText(/Only keys with a stored value or an override/i),
    );

    expect(
      screen.queryByTestId('entitlement-row-digestsPerMonth'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('entitlement-row-aiAnswers')).toBeInTheDocument();
  });
});
