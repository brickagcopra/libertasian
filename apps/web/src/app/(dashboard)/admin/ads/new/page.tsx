'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save } from 'lucide-react';
import Link from 'next/link';

import { useCreateCampaign } from '@/features/ads/hooks/use-ads';
import type { CreateCampaignInput } from '@/features/ads/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';

const PAGE_OPTIONS = [
  { value: 'homepage', label: 'Homepage' },
  { value: 'blog', label: 'Blog' },
  { value: 'search', label: 'Search' },
  { value: 'reader', label: 'Reader' },
  { value: 'pricing', label: 'Pricing' },
  { value: '*', label: 'All Pages' },
];

export default function NewCampaignPage() {
  const router = useRouter();
  const createMutation = useCreateCampaign();

  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [priority, setPriority] = useState(0);
  const [targetPages, setTargetPages] = useState<string[]>(['*']);
  const [targetUserType, setTargetUserType] = useState<string>('');
  const [maxImpressions, setMaxImpressions] = useState('');
  const [maxImpressionsPerUser, setMaxImpressionsPerUser] = useState('');
  const [showAfterSeconds, setShowAfterSeconds] = useState(0);
  const [showOncePerSession, setShowOncePerSession] = useState(true);

  const handleTogglePage = (page: string) => {
    if (page === '*') {
      setTargetPages(['*']);
      return;
    }
    setTargetPages((prev) => {
      const withoutAll = prev.filter((p) => p !== '*');
      if (withoutAll.includes(page)) {
        return withoutAll.filter((p) => p !== page);
      }
      return [...withoutAll, page];
    });
  };

  const handleSave = async (status: 'draft' | 'active') => {
    const input: CreateCampaignInput = {
      name,
      status,
      targetPages,
      priority,
      ...(startDate && { startDate: new Date(startDate).toISOString() }),
      ...(endDate && { endDate: new Date(endDate).toISOString() }),
      ...(targetUserType && { targetUserType }),
      ...(maxImpressions && { maxImpressions: parseInt(maxImpressions, 10) }),
      ...(maxImpressionsPerUser && { maxImpressionsPerUser: parseInt(maxImpressionsPerUser, 10) }),
      showAfterSeconds,
      showOncePerSession,
    };

    const campaign = await createMutation.mutateAsync(input);
    router.push(`/admin/ads/${campaign.id}/edit`);
  };

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
          <h1 className="text-2xl font-bold">New Campaign</h1>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => handleSave('draft')}
            disabled={!name || createMutation.isPending}
          >
            <Save className="mr-2 h-4 w-4" />
            Save as Draft
          </Button>
          <Button
            onClick={() => handleSave('active')}
            disabled={!name || createMutation.isPending}
          >
            Save &amp; Activate
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Campaign Details */}
        <Card>
          <CardHeader>
            <CardTitle>Campaign Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">Campaign Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Pro Plan Upgrade Q2"
                className="mt-1.5"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="mt-1.5"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="priority">Priority (0-1000, higher = shown first)</Label>
              <Input
                id="priority"
                type="number"
                min={0}
                max={1000}
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value, 10) || 0)}
                className="mt-1.5"
              />
            </div>
          </CardContent>
        </Card>

        {/* Targeting */}
        <Card>
          <CardHeader>
            <CardTitle>Targeting</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Target Pages</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {PAGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleTogglePage(opt.value)}
                    className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                      targetPages.includes(opt.value)
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-300 text-gray-600 hover:border-gray-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="targetUserType">Target User Type</Label>
              <select
                id="targetUserType"
                value={targetUserType}
                onChange={(e) => setTargetUserType(e.target.value)}
                className="mt-1.5 w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="">All Users</option>
                <option value="free">Free Users</option>
                <option value="authenticated">Authenticated Users</option>
                <option value="anonymous">Anonymous Visitors</option>
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Frequency Control */}
        <Card>
          <CardHeader>
            <CardTitle>Frequency Control</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="maxImpressions">Max Total Impressions</Label>
                <Input
                  id="maxImpressions"
                  type="number"
                  min={1}
                  value={maxImpressions}
                  onChange={(e) => setMaxImpressions(e.target.value)}
                  placeholder="Unlimited"
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="maxPerUser">Max Impressions per User</Label>
                <Input
                  id="maxPerUser"
                  type="number"
                  min={1}
                  value={maxImpressionsPerUser}
                  onChange={(e) => setMaxImpressionsPerUser(e.target.value)}
                  placeholder="Unlimited"
                  className="mt-1.5"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="showAfter">Show After (seconds)</Label>
              <Input
                id="showAfter"
                type="number"
                min={0}
                value={showAfterSeconds}
                onChange={(e) => setShowAfterSeconds(parseInt(e.target.value, 10) || 0)}
                className="mt-1.5"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Show Once per Session</p>
                <p className="text-sm text-muted-foreground">
                  Don&apos;t show again after user dismisses or clicks
                </p>
              </div>
              <Switch checked={showOncePerSession} onCheckedChange={setShowOncePerSession} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
