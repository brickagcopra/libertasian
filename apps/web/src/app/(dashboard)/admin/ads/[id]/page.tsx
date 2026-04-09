'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Pencil } from 'lucide-react';

import { useAdminCampaign, useCampaignAnalytics } from '@/features/ads/hooks/use-ads';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function CampaignDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const { data: campaign, isLoading } = useAdminCampaign(id);
  const { data: analytics } = useCampaignAnalytics(id);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Campaign not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/ads">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{campaign.name}</h1>
            <Badge
              variant={campaign.status === 'active' ? 'default' : 'secondary'}
              className="mt-1"
            >
              {campaign.status}
            </Badge>
          </div>
        </div>
        <Link href={`/admin/ads/${id}/edit`}>
          <Button variant="outline">
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
        </Link>
      </div>

      {/* Analytics Summary */}
      {analytics && (
        <div className="grid gap-4 sm:grid-cols-4">
          {[
            { label: 'Impressions', value: analytics.summary.impressions.toLocaleString() },
            { label: 'Clicks', value: analytics.summary.clicks.toLocaleString() },
            { label: 'Dismissals', value: analytics.summary.dismissals.toLocaleString() },
            { label: 'CTR', value: analytics.summary.ctr.toFixed(2) + '%' },
          ].map((stat) => (
            <Card key={stat.label}>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="mt-1 text-2xl font-bold">{stat.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Campaign Info */}
      <Card>
        <CardHeader>
          <CardTitle>Campaign Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-sm text-muted-foreground">Date Range</dt>
              <dd className="mt-1 font-medium">
                {formatDate(campaign.startDate)} — {formatDate(campaign.endDate)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Priority</dt>
              <dd className="mt-1 font-medium">{campaign.priority}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Target Pages</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {campaign.targetPages.map((p) => (
                  <Badge key={p} variant="outline">{p}</Badge>
                ))}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Target User Type</dt>
              <dd className="mt-1 font-medium">{campaign.targetUserType || 'All'}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Max Impressions</dt>
              <dd className="mt-1 font-medium">
                {campaign.maxImpressions?.toLocaleString() ?? 'Unlimited'}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Show After</dt>
              <dd className="mt-1 font-medium">{campaign.showAfterSeconds}s delay</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Creatives */}
      <Card>
        <CardHeader>
          <CardTitle>Creatives ({campaign.creatives.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {campaign.creatives.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground">
              No creatives yet. Edit this campaign to add creatives.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {campaign.creatives.map((creative) => (
                <div
                  key={creative.id}
                  className="rounded-lg border p-4"
                  style={{
                    backgroundColor: creative.bgColor ?? undefined,
                    color: creative.textColor ?? undefined,
                  }}
                >
                  <Badge variant="outline" className="mb-2">
                    {creative.displayType}
                  </Badge>
                  <h3 className="font-semibold">{creative.headline}</h3>
                  {creative.bodyText && (
                    <p className="mt-1 text-sm opacity-80">{creative.bodyText}</p>
                  )}
                  {creative.ctaText && (
                    <p className="mt-2 text-sm font-medium">
                      CTA: {creative.ctaText} &rarr; {creative.ctaUrl}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Events */}
      {analytics && analytics.recentEvents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Events</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Page</TableHead>
                  <TableHead>Session</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.recentEvents.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <Badge variant="outline">{event.eventType}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{event.page ?? '—'}</TableCell>
                    <TableCell className="max-w-[120px] truncate font-mono text-xs">
                      {event.sessionId ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm">{formatDate(event.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
