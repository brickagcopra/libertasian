import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
    setOnUnauthorized: jest.fn(),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

const mockSignOut = jest.fn().mockResolvedValue(undefined);
jest.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ signOut: mockSignOut }),
}));

import { apiClient } from '@/lib/api-client';
import DevicesScreen from '@/app/settings/devices';
import {
  describeDeviceLimits,
  deviceLabel,
  type DeviceSession,
} from '@/features/devices/hooks/use-devices';

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockDelete = apiClient.delete as jest.MockedFunction<typeof apiClient.delete>;
const alertMock = jest.spyOn(Alert, 'alert');

/** Press the destructive button of the last Alert shown. */
function confirmAlert() {
  const buttons = alertMock.mock.calls.at(-1)?.[2] ?? [];
  const destructive = buttons.find((b) => b.style === 'destructive');
  destructive?.onPress?.();
}

function device(over: Partial<DeviceSession>): DeviceSession {
  return {
    familyId: 'f',
    deviceFingerprint: null,
    deviceName: null,
    createdAt: '2026-11-22T00:00:00Z',
    lastUsedAt: '2026-11-22T00:00:00Z',
    isCurrent: false,
    inUse: null,
    ...over,
  };
}

const DEVICES = [
  device({ familyId: 'web', deviceName: 'Chrome on Windows', inUse: true, lastUsedAt: '2026-11-22T09:00:00Z' }),
  device({ familyId: 'me', deviceName: 'iPhone 15 (iOS 26.1)', isCurrent: true }),
];

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DevicesScreen />
    </QueryClientProvider>,
  );
}

describe('DevicesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    alertMock.mockImplementation(() => undefined);
    mockGet.mockImplementation(async (url: string) =>
      url === '/auth/sessions/limits' ? { maxSignedIn: 3, maxInUse: 2 } : DEVICES,
    );
    mockDelete.mockResolvedValue(undefined);
    mockPost.mockResolvedValue({ revoked: 1 });
  });

  it('lists devices with this device first and shows the limits', async () => {
    const { findByText, getByText } = renderScreen();
    expect(
      await findByText('Your account allows up to 3 devices signed in, 2 in use at the same time.'),
    ).toBeTruthy();
    expect(getByText('This device')).toBeTruthy();
    expect(getByText('In use now')).toBeTruthy();
  });

  it('signs out another device after confirming', async () => {
    const { findByLabelText } = renderScreen();
    fireEvent.press(await findByLabelText('Sign out Chrome on Windows'));
    confirmAlert();
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/auth/sessions/web'));
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('signs this device out through the normal sign-out', async () => {
    const { findByLabelText } = renderScreen();
    fireEvent.press(await findByLabelText('Sign out iPhone 15 (iOS 26.1)'));
    confirmAlert();
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('signs out all other devices', async () => {
    const { findByText } = renderScreen();
    fireEvent.press(await findByText('Sign out all other devices'));
    confirmAlert();
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/auth/sessions/revoke-others'));
  });
});

describe('device helpers', () => {
  it('describes caps', () => {
    expect(describeDeviceLimits(undefined)).toBeNull();
    expect(describeDeviceLimits({ maxSignedIn: null, maxInUse: null })).toBeNull();
    expect(describeDeviceLimits({ maxSignedIn: 1, maxInUse: null })).toBe(
      'Your account allows up to 1 device signed in.',
    );
  });

  it('labels devices', () => {
    expect(deviceLabel({ deviceName: 'Pixel 9', deviceFingerprint: null })).toBe('Pixel 9');
    expect(deviceLabel({ deviceName: null, deviceFingerprint: '1.2.3|okhttp/4.12' })).toBe(
      'Android device',
    );
    expect(deviceLabel({ deviceName: null, deviceFingerprint: null })).toBe('Unknown device');
  });
});
