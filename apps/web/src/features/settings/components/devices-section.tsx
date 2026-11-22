'use client';

import { LogOutIcon, MonitorSmartphoneIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLogout } from '@/features/auth/hooks/use-auth';

import {
  type Session,
  type SessionLimits,
  useRevokeOtherSessions,
  useRevokeSession,
  useSessionLimits,
  useSessions,
} from '../hooks/use-settings';

/**
 * "Your devices" (device limits, phase 2): every device signed in to this
 * account, which one this is, which are in use right now, and the account's
 * caps. Signing this device out is a normal logout; any other device can be
 * signed out individually or all at once.
 */
export function DevicesSection() {
  const { data: sessions, isLoading } = useSessions();
  const { data: limits } = useSessionLimits();
  const revokeSession = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const logout = useLogout();

  if (isLoading) return <DevicesSkeleton />;

  // This device first, then most recently used.
  const devices = [...(sessions ?? [])].sort(
    (a, b) =>
      Number(b.isCurrent) - Number(a.isCurrent) ||
      new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime(),
  );
  const others = devices.filter((d) => !d.isCurrent);
  const limitText = describeLimits(limits);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Your devices</CardTitle>
          {others.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={revokeOthers.isPending}
              onClick={() => revokeOthers.mutate()}
            >
              <LogOutIcon className="mr-1.5 h-3.5 w-3.5" />
              Sign out all other devices
            </Button>
          )}
        </div>
        {limitText && <p className="text-muted-foreground text-sm">{limitText}</p>}
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {devices.map((device) => (
            <li
              key={device.familyId}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex min-w-0 items-start gap-3">
                <MonitorSmartphoneIcon className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="truncate">{deviceLabel(device)}</span>
                    {device.isCurrent && <Badge variant="secondary">This device</Badge>}
                    {device.inUse && !device.isCurrent && (
                      <Badge variant="outline">In use now</Badge>
                    )}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Last active {new Date(device.lastUsedAt).toLocaleString()}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive shrink-0"
                disabled={device.isCurrent ? logout.isPending : revokeSession.isPending}
                onClick={() =>
                  device.isCurrent ? logout.mutate() : revokeSession.mutate(device.familyId)
                }
              >
                Sign out
              </Button>
            </li>
          ))}
          {devices.length === 0 && (
            <li className="text-muted-foreground px-4 py-6 text-center text-sm">
              No signed-in devices
            </li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

/** One sentence for the account's caps, or null when it has none. */
export function describeLimits(limits: SessionLimits | undefined): string | null {
  if (!limits) return null;
  const parts: string[] = [];
  if (limits.maxSignedIn !== null) {
    parts.push(`up to ${limits.maxSignedIn} ${plural(limits.maxSignedIn, 'device')} signed in`);
  }
  if (limits.maxInUse !== null) {
    parts.push(`${limits.maxInUse} in use at the same time`);
  }
  if (parts.length === 0) return null;
  const sentence = parts.join(', ');
  return `Your account allows ${sentence}.`;
}

/** Name the client reported, else a guess from the stored user agent. */
export function deviceLabel(device: Pick<Session, 'deviceName' | 'deviceFingerprint'>): string {
  if (device.deviceName) return device.deviceName;
  const ua = device.deviceFingerprint?.split('|')[1];
  if (!ua) return 'Unknown device';
  if (ua.includes('Edg/')) return 'Edge browser';
  if (ua.includes('Firefox')) return 'Firefox browser';
  if (ua.includes('Chrome')) return 'Chrome browser';
  if (ua.includes('Safari')) return 'Safari browser';
  return ua.substring(0, 60);
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

function DevicesSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-32" />
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {[1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3">
              <div className="space-y-1">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-44" />
              </div>
              <Skeleton className="h-4 w-14" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
