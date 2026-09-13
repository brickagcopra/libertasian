import React from 'react';
import { render, act } from '@testing-library/react-native';

const mockUseSegments = jest.fn<string[], []>(() => []);
jest.mock('expo-router', () => ({
  useSegments: () => mockUseSegments(),
}));

jest.mock('@/lib/analytics', () => ({
  mobileAnalytics: {
    initialize: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn(),
    ensureSession: jest.fn().mockResolvedValue(undefined),
    trackPageView: jest.fn(),
  },
}));

import { AppState } from 'react-native';

import { mobileAnalytics } from '@/lib/analytics';
import { useAnalyticsNavigationTracking } from '@/features/analytics/use-analytics-navigation';

const trackPageView = mobileAnalytics.trackPageView as jest.Mock;
const ensureSession = mobileAnalytics.ensureSession as jest.Mock;
const initialize = mobileAnalytics.initialize as jest.Mock;

function Harness({ isAuthenticated = true }: { isAuthenticated?: boolean }) {
  useAnalyticsNavigationTracking(isAuthenticated);
  return null;
}

describe('useAnalyticsNavigationTracking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSegments.mockReturnValue(['(tabs)', 'digests']);
  });

  it('tracks a page view for the current route on mount', () => {
    render(<Harness />);
    expect(trackPageView).toHaveBeenCalledWith('/(tabs)/digests');
  });

  it('tracks one page view per route change', () => {
    const { rerender } = render(<Harness />);

    mockUseSegments.mockReturnValue(['bar-exams', '[id]']);
    rerender(<Harness />);

    mockUseSegments.mockReturnValue(['digest', '[id]']);
    rerender(<Harness />);

    expect(trackPageView.mock.calls.map(([p]) => p)).toEqual([
      '/(tabs)/digests',
      '/bar-exams/[id]',
      '/digest/[id]',
    ]);
  });

  it('does not re-track when the route is unchanged', () => {
    const { rerender } = render(<Harness />);
    rerender(<Harness />);
    expect(trackPageView).toHaveBeenCalledTimes(1);
  });

  it('passes the router segments through, dynamic params included', () => {
    // useSegments yields the ROUTE pattern — `['digest', '[id]']`, not the real
    // id — which is why it is preferred over usePathname here.
    mockUseSegments.mockReturnValue(['reader', '[id]']);
    render(<Harness />);
    expect(trackPageView).toHaveBeenCalledWith('/reader/[id]');
  });

  it('normalises an empty segment list to the root', () => {
    mockUseSegments.mockReturnValue([]);
    render(<Harness />);
    expect(trackPageView).toHaveBeenCalledWith('/');
  });

  it('initializes the client once — nothing did before this hook', () => {
    const { rerender } = render(<Harness />);
    rerender(<Harness />);
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('tears the client down on unmount', () => {
    const { unmount } = render(<Harness />);
    unmount();
    expect(mobileAnalytics.destroy).toHaveBeenCalledTimes(1);
  });

  it('starts a session on mount', () => {
    render(<Harness />);
    expect(ensureSession).toHaveBeenCalledWith('/(tabs)/digests');
  });

  it('starts a session again on foreground', () => {
    const addEventListener = jest.spyOn(AppState, 'addEventListener');
    render(<Harness />);

    const handler = addEventListener.mock.calls.at(-1)?.[1] as (s: string) => void;
    ensureSession.mockClear();
    act(() => handler('active'));

    expect(ensureSession).toHaveBeenCalledTimes(1);
    addEventListener.mockRestore();
  });

  it('does nothing on background', () => {
    const addEventListener = jest.spyOn(AppState, 'addEventListener');
    render(<Harness />);

    const handler = addEventListener.mock.calls.at(-1)?.[1] as (s: string) => void;
    ensureSession.mockClear();
    act(() => handler('background'));

    expect(ensureSession).not.toHaveBeenCalled();
    addEventListener.mockRestore();
  });

  it('uses the latest route when foregrounding, not the mount-time one', () => {
    const addEventListener = jest.spyOn(AppState, 'addEventListener');
    const { rerender } = render(<Harness />);

    mockUseSegments.mockReturnValue(['(tabs)', 'search']);
    rerender(<Harness />);

    const handler = addEventListener.mock.calls.at(-1)?.[1] as (s: string) => void;
    ensureSession.mockClear();
    act(() => handler('active'));

    expect(ensureSession).toHaveBeenCalledWith('/(tabs)/search');
    addEventListener.mockRestore();
  });

  it('tracks nothing while signed out', () => {
    // track() posts to /analytics/events/auth, which is behind JwtAuthGuard —
    // firing on the login screen would 401 every event.
    render(<Harness isAuthenticated={false} />);
    expect(trackPageView).not.toHaveBeenCalled();
    expect(ensureSession).not.toHaveBeenCalled();
  });

  it('starts tracking as soon as a session appears', () => {
    const { rerender } = render(<Harness isAuthenticated={false} />);
    rerender(<Harness isAuthenticated />);

    expect(ensureSession).toHaveBeenCalledWith('/(tabs)/digests');
    expect(trackPageView).toHaveBeenCalledWith('/(tabs)/digests');
  });
});
