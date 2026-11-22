'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { PermissionGate } from '@/components/layout/permission-gate';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient } from '@/lib/api-client';

interface TravelJump {
  from: string;
  to: string;
  km: number;
  minutes: number;
  at: string;
}

interface SharingSignal {
  userId: string;
  email: string;
  fullName: string;
  reasons: ('many_places' | 'impossible_travel')[];
  places: string[];
  jumps: TravelJump[];
  events: number;
  lastSeenAt: string;
}

interface SharingReport {
  windowHours: number;
  thresholds: { minPlaces: number; minJumpKm: number; maxSpeedKmh: number };
  scannedEvents: number;
  truncated: boolean;
  signals: SharingSignal[];
}

const WINDOWS = [24, 72, 168] as const;
const ADMIN_USERS = ['admin:users'];

const REASON_LABEL: Record<SharingSignal['reasons'][number], string> = {
  many_places: 'Many places',
  impossible_travel: 'Impossible travel',
};

/**
 * Possible account sharing (device limits, phase 2c). Advisory: an account
 * here has been seen in many places or moved faster than a person can, based
 * on the coarse IP location of its sign-ins and token refreshes. Mobile
 * carrier IPs can geolocate far from the user, so treat a row as a reason to
 * look, not as proof.
 */
export default function AccountSharingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Possible account sharing</h1>
        <p className="text-muted-foreground text-sm">
          Accounts seen in many places or moving faster than one person can. Based on the
          approximate location of each sign-in&apos;s IP address. Advisory only: nothing here
          changes an account.
        </p>
      </div>
      <PermissionGate
        permissions={ADMIN_USERS}
        hideWhileLoading={false}
        fallback={<p className="text-muted-foreground text-sm">You need the admin:users permission.</p>}
      >
        <SharingReportView />
      </PermissionGate>
    </div>
  );
}

function SharingReportView() {
  const [hours, setHours] = useState<(typeof WINDOWS)[number]>(24);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'sharing-signals', hours],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: SharingReport }>(
        '/admin/users/sharing-signals',
        { params: { hours: String(hours) } },
      );
      return res.data;
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>
            {data ? `${data.signals.length} flagged` : 'Flagged accounts'}
          </CardTitle>
          <div className="flex gap-1" role="group" aria-label="Time window">
            {WINDOWS.map((w) => (
              <Button
                key={w}
                size="sm"
                variant={w === hours ? 'default' : 'outline'}
                aria-pressed={w === hours}
                onClick={() => setHours(w)}
              >
                {w === 168 ? '7 days' : `${w} h`}
              </Button>
            ))}
          </div>
        </div>
        {data && (
          <p className="text-muted-foreground text-xs">
            Flags {data.thresholds.minPlaces}+ places, or a jump over {data.thresholds.minJumpKm}{' '}
            km faster than {data.thresholds.maxSpeedKmh} km/h. Scanned {data.scannedEvents} events.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {data?.truncated && (
          <Alert>
            <AlertDescription>
              The scan hit its row limit; older events in this window were not included.
            </AlertDescription>
          </Alert>
        )}
        {isLoading && <Skeleton className="h-24 w-full" />}
        {isError && <p className="text-destructive text-sm">Could not load the report.</p>}
        {data && data.signals.length === 0 && (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No accounts flagged in this window.
          </p>
        )}
        <ul className="divide-y">
          {data?.signals.map((s) => (
            <li key={s.userId} className="space-y-1 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.fullName || s.email || s.userId}</span>
                <span className="text-muted-foreground text-sm">{s.email}</span>
                {s.reasons.map((r) => (
                  <Badge key={r} variant={r === 'impossible_travel' ? 'destructive' : 'secondary'}>
                    {REASON_LABEL[r]}
                  </Badge>
                ))}
              </div>
              <p className="text-sm">
                {s.places.length} {s.places.length === 1 ? 'place' : 'places'}: {s.places.join(' · ')}
              </p>
              {s.jumps.map((j) => (
                <p key={`${j.at}-${j.to}`} className="text-muted-foreground text-xs">
                  {j.from} → {j.to}: {j.km.toLocaleString()} km in {j.minutes} min (
                  {new Date(j.at).toLocaleString()})
                </p>
              ))}
              <p className="text-muted-foreground text-xs">
                {s.events} events · last seen {new Date(s.lastSeenAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
