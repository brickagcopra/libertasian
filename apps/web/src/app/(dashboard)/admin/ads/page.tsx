'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, MoreHorizontal, Pencil, Trash2, Pause, Play, BarChart3 } from 'lucide-react';

import {
  useAdminCampaigns,
  useDeleteCampaign,
  useUpdateCampaignStatus,
} from '@/features/ads/hooks/use-ads';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const STATUS_TABS = [
  { label: 'All', value: undefined },
  { label: 'Active', value: 'active' },
  { label: 'Paused', value: 'paused' },
  { label: 'Draft', value: 'draft' },
  { label: 'Ended', value: 'ended' },
] as const;

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function statusVariant(status: string) {
  switch (status) {
    case 'active':
      return 'default' as const;
    case 'paused':
      return 'secondary' as const;
    case 'draft':
      return 'outline' as const;
    case 'ended':
      return 'destructive' as const;
    default:
      return 'secondary' as const;
  }
}

function calculateCtr(impressions: number, clicks: number): string {
  if (impressions === 0) return '0.00%';
  return ((clicks / impressions) * 100).toFixed(2) + '%';
}

export default function AdminAdsPage() {
  const [activeStatus, setActiveStatus] = useState<string | undefined>(undefined);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useAdminCampaigns(activeStatus);
  const deleteMutation = useDeleteCampaign();
  const statusMutation = useUpdateCampaignStatus();

  const campaigns = data?.data ?? [];

  const stats = {
    active: campaigns.filter((c) => c.status === 'active').length,
    totalImpressions: campaigns.reduce((sum, c) => sum + c.impressionCount, 0),
    totalClicks: campaigns.reduce((sum, c) => sum + c.clickCount, 0),
    avgCtr: campaigns.length > 0
      ? (
          (campaigns.reduce((sum, c) => sum + c.clickCount, 0) /
            Math.max(1, campaigns.reduce((sum, c) => sum + c.impressionCount, 0))) *
          100
        ).toFixed(2) + '%'
      : '0.00%',
  };

  const handleToggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    await statusMutation.mutateAsync({ id, status: newStatus });
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await deleteMutation.mutateAsync(deleteId);
    setDeleteId(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Advertising</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage ad campaigns, creatives, and analytics
          </p>
        </div>
        <Link href="/admin/ads/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Campaign
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: 'Active Campaigns', value: stats.active },
          { label: 'Total Impressions', value: stats.totalImpressions.toLocaleString() },
          { label: 'Total Clicks', value: stats.totalClicks.toLocaleString() },
          { label: 'Avg CTR', value: stats.avgCtr },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{stat.label}</p>
              <p className="mt-1 text-2xl font-bold">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Status Tabs */}
      <div className="flex gap-1 rounded-lg border bg-muted/50 p-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.label}
            onClick={() => setActiveStatus(tab.value)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeStatus === tab.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Campaigns Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date Range</TableHead>
                <TableHead>Impressions</TableHead>
                <TableHead>Clicks</TableHead>
                <TableHead>CTR</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : campaigns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    No campaigns found
                  </TableCell>
                </TableRow>
              ) : (
                campaigns.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell>
                      <p className="font-medium">{campaign.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {campaign.creatives.length} creative{campaign.creatives.length !== 1 ? 's' : ''}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(campaign.status)}>{campaign.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDate(campaign.startDate)} — {formatDate(campaign.endDate)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {campaign.impressionCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">
                      {campaign.clickCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">
                      {calculateCtr(campaign.impressionCount, campaign.clickCount)}
                    </TableCell>
                    <TableCell className="text-sm">{campaign.priority}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/admin/ads/${campaign.id}`}>
                              <BarChart3 className="mr-2 h-4 w-4" />
                              Analytics
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/admin/ads/${campaign.id}/edit`}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit
                            </Link>
                          </DropdownMenuItem>
                          {(campaign.status === 'active' || campaign.status === 'paused') && (
                            <DropdownMenuItem
                              onClick={() => handleToggleStatus(campaign.id, campaign.status)}
                            >
                              {campaign.status === 'active' ? (
                                <>
                                  <Pause className="mr-2 h-4 w-4" />
                                  Pause
                                </>
                              ) : (
                                <>
                                  <Play className="mr-2 h-4 w-4" />
                                  Activate
                                </>
                              )}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() => setDeleteId(campaign.id)}
                            className="text-red-600"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the campaign, all its creatives, and all event data.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
