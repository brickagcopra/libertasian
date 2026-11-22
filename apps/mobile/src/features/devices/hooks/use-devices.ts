import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export interface DeviceSession {
  familyId: string;
  deviceFingerprint: string | null;
  /** "iPhone 15 (iOS 26.1)", "Chrome on Windows"; null for older sign-ins. */
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string;
  /** The session this app is using. */
  isCurrent: boolean;
  /** Holds an in-use slot right now; null when unknown. */
  inUse: boolean | null;
}

export interface DeviceLimits {
  maxSignedIn: number | null;
  maxInUse: number | null;
}

export const deviceKeys = {
  all: ['devices'] as const,
  list: () => [...deviceKeys.all, 'list'] as const,
  limits: () => [...deviceKeys.all, 'limits'] as const,
};

export function useDevices() {
  return useQuery({
    queryKey: deviceKeys.list(),
    queryFn: () => apiClient.get<DeviceSession[]>('/auth/sessions'),
  });
}

export function useDeviceLimits() {
  return useQuery({
    queryKey: deviceKeys.limits(),
    queryFn: () => apiClient.get<DeviceLimits>('/auth/sessions/limits'),
  });
}

export function useSignOutDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (familyId: string) => apiClient.delete(`/auth/sessions/${familyId}`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: deviceKeys.all }),
  });
}

export function useSignOutOtherDevices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post<{ revoked: number }>('/auth/sessions/revoke-others'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: deviceKeys.all }),
  });
}

/** One sentence for the account's caps, or null when it has none. */
export function describeDeviceLimits(limits: DeviceLimits | undefined): string | null {
  if (!limits) return null;
  const parts: string[] = [];
  if (limits.maxSignedIn !== null) {
    parts.push(
      `up to ${limits.maxSignedIn} ${limits.maxSignedIn === 1 ? 'device' : 'devices'} signed in`,
    );
  }
  if (limits.maxInUse !== null) parts.push(`${limits.maxInUse} in use at the same time`);
  return parts.length ? `Your account allows ${parts.join(', ')}.` : null;
}

/** Name the client reported, else a guess from the stored user agent. */
export function deviceLabel(device: Pick<DeviceSession, 'deviceName' | 'deviceFingerprint'>): string {
  if (device.deviceName) return device.deviceName;
  const ua = device.deviceFingerprint?.split('|')[1];
  if (!ua) return 'Unknown device';
  if (ua.includes('Edg/')) return 'Edge browser';
  if (ua.includes('Firefox')) return 'Firefox browser';
  if (ua.includes('Chrome')) return 'Chrome browser';
  if (ua.includes('Safari')) return 'Safari browser';
  if (ua.includes('okhttp') || ua.includes('Android')) return 'Android device';
  if (ua.includes('CFNetwork') || ua.includes('Darwin')) return 'iPhone or iPad';
  return ua.substring(0, 60);
}

/** This device first, then most recently used. */
export function sortDevices(devices: DeviceSession[]): DeviceSession[] {
  return [...devices].sort(
    (a, b) =>
      Number(b.isCurrent) - Number(a.isCurrent) ||
      new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime(),
  );
}
