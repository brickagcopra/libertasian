import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

const revokeOne = vi.fn();
const revokeOthers = vi.fn();
const logout = vi.fn();
let sessions: unknown[] = [];
let limits: unknown = undefined;

vi.mock('../hooks/use-settings', () => ({
  useSessions: () => ({ data: sessions, isLoading: false }),
  useSessionLimits: () => ({ data: limits }),
  useRevokeSession: () => ({ mutate: revokeOne, isPending: false }),
  useRevokeOtherSessions: () => ({ mutate: revokeOthers, isPending: false }),
}));
vi.mock('@/features/auth/hooks/use-auth', () => ({
  useLogout: () => ({ mutate: logout, isPending: false }),
}));

import { DevicesSection, describeLimits, deviceLabel } from './devices-section';

const device = (over: Record<string, unknown>) => ({
  familyId: 'f',
  deviceFingerprint: null,
  deviceName: null,
  createdAt: '2026-11-22T00:00:00Z',
  lastUsedAt: '2026-11-22T00:00:00Z',
  isCurrent: false,
  inUse: null,
  ...over,
});

describe('DevicesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limits = undefined;
    sessions = [
      device({ familyId: 'old', deviceName: 'iPhone 15 (iOS 26.1)', lastUsedAt: '2026-11-20T00:00:00Z', inUse: false }),
      device({ familyId: 'other', deviceName: 'Firefox on Linux', lastUsedAt: '2026-11-22T10:00:00Z', inUse: true }),
      device({ familyId: 'me', deviceName: 'Chrome on Windows', isCurrent: true, inUse: true }),
    ];
  });

  it('lists this device first, then most recently used, with badges', () => {
    render(<DevicesSection />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Chrome on Windows'),
      expect.stringContaining('Firefox on Linux'),
      expect.stringContaining('iPhone 15'),
    ]);
    expect(within(items[0]!).getByText('This device')).toBeTruthy();
    expect(within(items[1]!).getByText('In use now')).toBeTruthy();
    expect(within(items[2]!).queryByText('In use now')).toBeNull();
  });

  it('signs out another device by family id, and this device via logout', () => {
    render(<DevicesSection />);
    const items = screen.getAllByRole('listitem');
    fireEvent.click(within(items[1]!).getByRole('button', { name: 'Sign out' }));
    expect(revokeOne).toHaveBeenCalledWith('other');
    fireEvent.click(within(items[0]!).getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalled();
    expect(revokeOne).toHaveBeenCalledTimes(1);
  });

  it('signs out all other devices', () => {
    render(<DevicesSection />);
    fireEvent.click(screen.getByRole('button', { name: /Sign out all other devices/ }));
    expect(revokeOthers).toHaveBeenCalled();
  });

  it('hides "all other devices" when this is the only one', () => {
    sessions = [device({ familyId: 'me', isCurrent: true })];
    render(<DevicesSection />);
    expect(screen.queryByRole('button', { name: /all other devices/ })).toBeNull();
  });

  it('shows the account limits', () => {
    limits = { maxSignedIn: 3, maxInUse: 2 };
    render(<DevicesSection />);
    expect(
      screen.getByText('Your account allows up to 3 devices signed in, 2 in use at the same time.'),
    ).toBeTruthy();
  });
});

describe('describeLimits', () => {
  it('handles missing and partial caps', () => {
    expect(describeLimits(undefined)).toBeNull();
    expect(describeLimits({ maxSignedIn: null, maxInUse: null })).toBeNull();
    expect(describeLimits({ maxSignedIn: 2, maxInUse: null })).toBe(
      'Your account allows up to 2 devices signed in.',
    );
    expect(describeLimits({ maxSignedIn: null, maxInUse: 1 })).toBe(
      'Your account allows 1 in use at the same time.',
    );
  });
});

describe('deviceLabel', () => {
  it('prefers the reported name, then the user agent', () => {
    expect(deviceLabel({ deviceName: 'Pixel 9', deviceFingerprint: '1.2.3|Chrome' })).toBe('Pixel 9');
    expect(deviceLabel({ deviceName: null, deviceFingerprint: '1.2.3|Mozilla Chrome/1 Edg/1' })).toBe(
      'Edge browser',
    );
    expect(deviceLabel({ deviceName: null, deviceFingerprint: null })).toBe('Unknown device');
  });
});
