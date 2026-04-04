'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Activity, Users, Zap, Radio } from 'lucide-react';

import type { AnalyticsRealtimeSnapshot } from '@libertasian/types';
import { KpiCard } from '@/components/analytics';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001/api/v1';

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-PH').format(value);
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function categoryColor(category: string): string {
  const colors: Record<string, string> = {
    search: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
    ai_answer: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
    digest: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    scan: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
    study: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300',
    workspace: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
    auth: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    billing: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300',
    navigation: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
    admin: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300',
  };
  return colors[category] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
}

export default function RealtimePage() {
  const [snapshot, setSnapshot] = useState<AnalyticsRealtimeSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    const es = new EventSource(`${API_BASE_URL}/admin/analytics/realtime`, {
      withCredentials: true,
    });

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as AnalyticsRealtimeSnapshot;
        setSnapshot(data);
      } catch {
        // Silently ignore parse errors
      }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      // Reconnect after 5 seconds
      setTimeout(connect, 5000);
    };

    eventSourceRef.current = es;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [connect]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Real-time Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Live platform activity — refreshes every 10 seconds
          </p>
        </div>
        <Badge
          variant={connected ? 'default' : 'destructive'}
          className="flex items-center gap-1.5"
        >
          <Radio className="size-3" />
          {connected ? 'Connected' : 'Disconnected'}
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard
          label="Active Sessions"
          value={formatNumber(snapshot?.activeSessionCount ?? 0)}
          trend={snapshot && snapshot.activeSessionCount > 0 ? 'up' : 'neutral'}
          comparison="Users online now"
          icon={Users}
        />
        <KpiCard
          label="Events (Last 5 min)"
          value={formatNumber(snapshot?.recentEventCount ?? 0)}
          trend="neutral"
          comparison="Total events recently"
          icon={Activity}
        />
        <KpiCard
          label="Events / Minute"
          value={
            snapshot?.eventsPerMinute !== undefined
              ? snapshot.eventsPerMinute.toFixed(1)
              : '—'
          }
          trend={
            snapshot && snapshot.eventsPerMinute > 10
              ? 'up'
              : snapshot && snapshot.eventsPerMinute > 0
                ? 'neutral'
                : 'neutral'
          }
          comparison="Current throughput"
          icon={Zap}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Live Event Feed</CardTitle>
          <CardDescription>
            Most recent events across the platform
            {snapshot?.timestamp && (
              <span className="ml-2 text-xs">
                Last update: {formatTime(snapshot.timestamp)}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!snapshot || snapshot.recentEvents.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {connected ? 'Waiting for events...' : 'Connecting...'}
            </p>
          ) : (
            <div className="max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4">Time</th>
                    <th className="pb-2 pr-4">Event</th>
                    <th className="pb-2 pr-4">Category</th>
                    <th className="pb-2 pr-4">Device</th>
                    <th className="pb-2">User</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {snapshot.recentEvents.map((event) => (
                    <tr key={event.id} className="hover:bg-muted/50">
                      <td className="py-2 pr-4 text-xs text-muted-foreground">
                        {formatTime(event.createdAt)}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">{event.eventName}</td>
                      <td className="py-2 pr-4">
                        <Badge variant="secondary" className={categoryColor(event.eventCategory)}>
                          {event.eventCategory}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 text-xs">
                        {event.deviceType ?? '—'}
                      </td>
                      <td className="py-2 font-mono text-xs text-muted-foreground">
                        {event.userId ? event.userId.slice(0, 12) + '...' : 'anon'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
