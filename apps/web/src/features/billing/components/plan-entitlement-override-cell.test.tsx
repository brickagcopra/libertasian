import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PlanEntitlementOverrideCell } from './plan-entitlement-override-cell';
import { apiClient } from '@/lib/api-client';

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

function countsEnvelope(data: Record<string, unknown>) {
  return { success: true, data };
}

function renderCell(props: Partial<Record<string, unknown>> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <PlanEntitlementOverrideCell
        planCode="free"
        entitlementKey="aiAnswers"
        planValue={15}
        {...(props as never)}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.get).mockResolvedValue(
    countsEnvelope({
      aiAnswers: {
        count: 10,
        values: [
          { value: 0, count: 9 },
          { value: 500, count: 1 },
        ],
      },
    }),
  );
  vi.mocked(apiClient.post).mockResolvedValue({
    success: true,
    data: {
      key: 'aiAnswers',
      valueEquals: 0,
      affectedCount: 9,
      subscriptionIds: ['s1'],
    },
  });
});

describe('PlanEntitlementOverrideCell', () => {
  it('reports how many subscriptions store their own value for the key', async () => {
    renderCell();

    expect(
      await screen.findByRole('button', {
        name: /10 subscriptions override this key/i,
      }),
    ).toBeInTheDocument();
  });

  it('renders a dash when nothing overrides the key', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(countsEnvelope({}));

    const { container } = renderCell();

    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    expect(
      screen.queryByRole('button', { name: /override this key/i }),
    ).not.toBeInTheDocument();
    expect(container).toHaveTextContent('—');
  });

  it('breaks the count down by distinct stored value and flags the conflicting one', async () => {
    renderCell();

    fireEvent.click(
      await screen.findByRole('button', {
        name: /10 subscriptions override this key/i,
      }),
    );

    expect(
      await screen.findByText(/9 subscriptions — plan grants 15/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 subscription — plan grants 15/i),
    ).toBeInTheDocument();
  });

  it('prunes only the value the admin picked', async () => {
    renderCell();

    fireEvent.click(
      await screen.findByRole('button', {
        name: /10 subscriptions override this key/i,
      }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Clear from 9' }),
    );

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        '/admin/subscriptions/entitlements-json/prune',
        { key: 'aiAnswers', valueEquals: 0 },
      ),
    );
    expect(
      await screen.findByText(/from 9 subscriptions/i),
    ).toBeInTheDocument();
  });

  it('reports a failed prune as having changed nothing', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('boom'));

    renderCell();

    fireEvent.click(
      await screen.findByRole('button', {
        name: /10 subscriptions override this key/i,
      }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Clear from 9' }),
    );

    expect(
      await screen.findByText(/Prune failed. Nothing was changed./i),
    ).toBeInTheDocument();
  });

  it('scopes the counts query to the plan being edited', async () => {
    renderCell({ planCode: 'pro' });

    await waitFor(() =>
      expect(apiClient.get).toHaveBeenCalledWith(
        '/admin/subscriptions/entitlements-json/stored-key-counts?planCode=pro',
      ),
    );
  });
});
