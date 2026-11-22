import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: (...args: unknown[]) => get(...args) },
}));
vi.mock('@/components/layout/permission-gate', () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import AccountSharingPage from './page';

const report = (signals: unknown[]) => ({
  success: true,
  data: {
    windowHours: 24,
    thresholds: { minPlaces: 4, minJumpKm: 500, maxSpeedKmh: 900 },
    scannedEvents: 12,
    truncated: false,
    signals,
  },
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AccountSharingPage />
    </QueryClientProvider>,
  );
}

describe('AccountSharingPage', () => {
  beforeEach(() => get.mockReset());

  it('says so when nothing is flagged', async () => {
    get.mockResolvedValue(report([]));
    renderPage();
    expect(await screen.findByText('No accounts flagged in this window.')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/admin/users/sharing-signals', { params: { hours: '24' } });
  });

  it('lists flagged accounts with reasons, places and jumps', async () => {
    get.mockResolvedValue(
      report([
        {
          userId: 'u1',
          email: 'ana@example.com',
          fullName: 'Ana Cruz',
          reasons: ['impossible_travel'],
          places: ['Manila, PH', 'Singapore, SG'],
          jumps: [{ from: 'Manila, PH', to: 'Singapore, SG', km: 2393, minutes: 20, at: '2026-11-22T01:00:00Z' }],
          events: 5,
          lastSeenAt: '2026-11-22T01:00:00Z',
        },
      ]),
    );
    renderPage();
    expect(await screen.findByText('Ana Cruz')).toBeTruthy();
    expect(screen.getByText('Impossible travel')).toBeTruthy();
    expect(screen.getByText(/2 places: Manila, PH · Singapore, SG/)).toBeTruthy();
    expect(screen.getByText(/Manila, PH → Singapore, SG: 2,393 km in 20 min/)).toBeTruthy();
  });

  it('switches the window', async () => {
    get.mockResolvedValue(report([]));
    renderPage();
    await screen.findByText('No accounts flagged in this window.');
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/admin/users/sharing-signals', { params: { hours: '168' } }),
    );
  });
});
