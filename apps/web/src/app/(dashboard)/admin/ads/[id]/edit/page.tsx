'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';
import Link from 'next/link';

import {
  useAdminCampaign,
  useUpdateCampaign,
  useCreateCreative,
  useUpdateCreative,
  useDeleteCreative,
} from '@/features/ads/hooks/use-ads';
import type { UpdateCampaignInput, CreateCreativeInput } from '@/features/ads/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

const PAGE_OPTIONS = [
  { value: 'homepage', label: 'Homepage' },
  { value: 'blog', label: 'Blog' },
  { value: 'search', label: 'Search' },
  { value: 'reader', label: 'Reader' },
  { value: 'pricing', label: 'Pricing' },
  { value: '*', label: 'All Pages' },
];

const DISPLAY_TYPES = [
  { value: 'modal', label: 'Modal Popup' },
  { value: 'slide_in', label: 'Slide-in' },
  { value: 'floating_bar', label: 'Floating Bar' },
  { value: 'inline_banner', label: 'Inline Banner' },
  { value: 'sticky_footer', label: 'Sticky Footer' },
];

export default function EditCampaignPage() {
  const params = useParams();
  const id = params.id as string;

  const { data: campaign, isLoading } = useAdminCampaign(id);
  const updateMutation = useUpdateCampaign();
  const createCreativeMutation = useCreateCreative();
  const deleteCreativeMutation = useDeleteCreative();

  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [priority, setPriority] = useState(0);
  const [targetPages, setTargetPages] = useState<string[]>(['*']);
  const [targetUserType, setTargetUserType] = useState('');
  const [maxImpressions, setMaxImpressions] = useState('');
  const [maxImpressionsPerUser, setMaxImpressionsPerUser] = useState('');
  const [showAfterSeconds, setShowAfterSeconds] = useState(0);
  const [showOncePerSession, setShowOncePerSession] = useState(true);
  const [initialized, setInitialized] = useState(false);

  // New creative form
  const [showCreativeForm, setShowCreativeForm] = useState(false);
  const [newCreative, setNewCreative] = useState<CreateCreativeInput>({
    displayType: 'modal',
    headline: '',
  });

  useEffect(() => {
    if (campaign && !initialized) {
      setName(campaign.name);
      setStartDate(campaign.startDate ? campaign.startDate.split('T')[0] : '');
      setEndDate(campaign.endDate ? campaign.endDate.split('T')[0] : '');
      setPriority(campaign.priority);
      setTargetPages(campaign.targetPages);
      setTargetUserType(campaign.targetUserType ?? '');
      setMaxImpressions(campaign.maxImpressions?.toString() ?? '');
      setMaxImpressionsPerUser(campaign.maxImpressionsPerUser?.toString() ?? '');
      setShowAfterSeconds(campaign.showAfterSeconds);
      setShowOncePerSession(campaign.showOncePerSession);
      setInitialized(true);
    }
  }, [campaign, initialized]);

  const handleTogglePage = (page: string) => {
    if (page === '*') {
      setTargetPages(['*']);
      return;
    }
    setTargetPages((prev) => {
      const withoutAll = prev.filter((p) => p !== '*');
      return withoutAll.includes(page)
        ? withoutAll.filter((p) => p !== page)
        : [...withoutAll, page];
    });
  };

  const handleSave = async () => {
    const input: UpdateCampaignInput & { id: string } = {
      id,
      name,
      targetPages,
      priority,
      showAfterSeconds,
      showOncePerSession,
      ...(startDate && { startDate: new Date(startDate).toISOString() }),
      ...(endDate && { endDate: new Date(endDate).toISOString() }),
      ...(targetUserType && { targetUserType }),
      ...(maxImpressions && { maxImpressions: parseInt(maxImpressions, 10) }),
      ...(maxImpressionsPerUser && { maxImpressionsPerUser: parseInt(maxImpressionsPerUser, 10) }),
    };

    await updateMutation.mutateAsync(input);
  };

  const handleAddCreative = async () => {
    if (!newCreative.headline) return;
    await createCreativeMutation.mutateAsync({ campaignId: id, ...newCreative });
    setShowCreativeForm(false);
    setNewCreative({ displayType: 'modal', headline: '' });
  };

  const handleDeleteCreative = async (creativeId: string) => {
    if (!confirm('Delete this creative?')) return;
    await deleteCreativeMutation.mutateAsync(creativeId);
  };

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
            <h1 className="text-2xl font-bold">Edit Campaign</h1>
            <Badge variant={campaign.status === 'active' ? 'default' : 'secondary'}>
              {campaign.status}
            </Badge>
          </div>
        </div>
        <Button onClick={handleSave} disabled={updateMutation.isPending}>
          <Save className="mr-2 h-4 w-4" />
          {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Campaign Details */}
        <Card>
          <CardHeader>
            <CardTitle>Campaign Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
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
              <Label htmlFor="priority">Priority</Label>
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

        {/* Frequency */}
        <Card>
          <CardHeader>
            <CardTitle>Frequency Control</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Max Total Impressions</Label>
                <Input
                  type="number"
                  min={1}
                  value={maxImpressions}
                  onChange={(e) => setMaxImpressions(e.target.value)}
                  placeholder="Unlimited"
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label>Max per User</Label>
                <Input
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
              <Label>Show After (seconds)</Label>
              <Input
                type="number"
                min={0}
                value={showAfterSeconds}
                onChange={(e) => setShowAfterSeconds(parseInt(e.target.value, 10) || 0)}
                className="mt-1.5"
              />
            </div>
            <div className="flex items-center justify-between">
              <p className="font-medium">Once per Session</p>
              <Switch checked={showOncePerSession} onCheckedChange={setShowOncePerSession} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Creatives */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Creatives ({campaign.creatives.length})</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCreativeForm(!showCreativeForm)}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Creative
          </Button>
        </CardHeader>
        <CardContent>
          {/* New Creative Form */}
          {showCreativeForm && (
            <div className="mb-6 space-y-4 rounded-lg border bg-muted/50 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Display Type</Label>
                  <select
                    value={newCreative.displayType}
                    onChange={(e) =>
                      setNewCreative((prev) => ({ ...prev, displayType: e.target.value }))
                    }
                    className="mt-1.5 w-full rounded-md border px-3 py-2 text-sm"
                  >
                    {DISPLAY_TYPES.map((dt) => (
                      <option key={dt.value} value={dt.value}>
                        {dt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Headline</Label>
                  <Input
                    value={newCreative.headline}
                    onChange={(e) =>
                      setNewCreative((prev) => ({ ...prev, headline: e.target.value }))
                    }
                    placeholder="Ad headline..."
                    maxLength={120}
                    className="mt-1.5"
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Body Text</Label>
                  <textarea
                    value={newCreative.bodyText ?? ''}
                    onChange={(e) =>
                      setNewCreative((prev) => ({ ...prev, bodyText: e.target.value }))
                    }
                    maxLength={500}
                    rows={2}
                    className="mt-1.5 w-full rounded-md border px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <div>
                    <Label>CTA Text</Label>
                    <Input
                      value={newCreative.ctaText ?? ''}
                      onChange={(e) =>
                        setNewCreative((prev) => ({ ...prev, ctaText: e.target.value }))
                      }
                      placeholder="e.g. Upgrade Now"
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label>CTA URL</Label>
                    <Input
                      value={newCreative.ctaUrl ?? ''}
                      onChange={(e) =>
                        setNewCreative((prev) => ({ ...prev, ctaUrl: e.target.value }))
                      }
                      placeholder="/pricing or https://..."
                      className="mt-1.5"
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleAddCreative}
                  disabled={!newCreative.headline || createCreativeMutation.isPending}
                  size="sm"
                >
                  {createCreativeMutation.isPending ? 'Adding...' : 'Add Creative'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowCreativeForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Existing Creatives */}
          {campaign.creatives.length === 0 && !showCreativeForm ? (
            <p className="py-4 text-center text-muted-foreground">
              No creatives yet. Click &quot;Add Creative&quot; to get started.
            </p>
          ) : (
            <div className="space-y-3">
              {campaign.creatives.map((creative) => (
                <div
                  key={creative.id}
                  className="flex items-start justify-between rounded-lg border p-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{creative.displayType}</Badge>
                      {creative.position && (
                        <Badge variant="secondary">{creative.position}</Badge>
                      )}
                    </div>
                    <h4 className="mt-2 font-semibold">{creative.headline}</h4>
                    {creative.bodyText && (
                      <p className="mt-1 text-sm text-muted-foreground">{creative.bodyText}</p>
                    )}
                    {creative.ctaText && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        CTA: {creative.ctaText} &rarr; {creative.ctaUrl}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteCreative(creative.id)}
                    className="text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
