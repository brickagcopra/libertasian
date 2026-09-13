import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const mockPathname = vi.fn<() => string>(() => '/digests');

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

vi.mock('@/lib/analytics', () => ({
  analytics: {
    startSession: vi.fn(),
    startHeartbeat: vi.fn(),
    stopHeartbeat: vi.fn(),
    endSession: vi.fn(),
    getSessionId: vi.fn(() => null),
    trackPageView: vi.fn(),
  },
}));

import { analytics } from '@/lib/analytics';
import { AnalyticsProvider } from './analytics-provider';

const trackPageView = vi.mocked(analytics.trackPageView);

describe('AnalyticsProvider navigation tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.mockReturnValue('/digests');
  });

  it('tracks a page view on first render', () => {
    // The provider has watched `pathname` since it was written and never
    // tracked anything from it, which is why analytics_events held 60 rows —
    // all of them mobile sign-in failures.
    render(<AnalyticsProvider>content</AnalyticsProvider>);
    expect(trackPageView).toHaveBeenCalledWith('/digests');
  });

  it('tracks a page view on each pathname change', () => {
    const { rerender } = render(<AnalyticsProvider>content</AnalyticsProvider>);

    mockPathname.mockReturnValue('/bar-exams/practice');
    rerender(<AnalyticsProvider>content</AnalyticsProvider>);

    mockPathname.mockReturnValue('/reader/8f1c2b64-0f2a-4c7e-9a1d-1b2c3d4e5f60');
    rerender(<AnalyticsProvider>content</AnalyticsProvider>);

    expect(trackPageView.mock.calls.map(([p]) => p)).toEqual([
      '/digests',
      '/bar-exams/practice',
      '/reader/8f1c2b64-0f2a-4c7e-9a1d-1b2c3d4e5f60',
    ]);
  });

  it('does not re-track when the pathname is unchanged', () => {
    const { rerender } = render(<AnalyticsProvider>content</AnalyticsProvider>);
    rerender(<AnalyticsProvider>content</AnalyticsProvider>);
    expect(trackPageView).toHaveBeenCalledTimes(1);
  });

  it('still starts the session exactly once', () => {
    const { rerender } = render(<AnalyticsProvider>content</AnalyticsProvider>);
    mockPathname.mockReturnValue('/search');
    rerender(<AnalyticsProvider>content</AnalyticsProvider>);
    expect(analytics.startSession).toHaveBeenCalledTimes(1);
  });

  it('hands the raw pathname to the client, which redacts it', () => {
    // Redaction lives in the shared route map so web and mobile cannot
    // disagree about what is safe to send — the provider must not pre-process.
    render(<AnalyticsProvider>content</AnalyticsProvider>);
    const [path] = trackPageView.mock.calls[0]!;
    expect(path).toBe('/digests');
  });
});
