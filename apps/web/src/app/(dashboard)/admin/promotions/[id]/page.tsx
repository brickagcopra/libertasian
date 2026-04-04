'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowLeft,
  Save,
  Pencil,
  X,
  Plus,
  Trash2,
  Play,
  Pause,
  Archive,
} from 'lucide-react';

import {
  useAdminPromotion,
  useUpdatePromotion,
  useArchivePromotion,
  useActivatePromotion,
  usePausePromotion,
  useSetPromotionRules,
  useSetPromotionBenefits,
  useSetPromotionPlanRules,
  usePromotionRedemptions,
  useRevokePromotionRedemption,
} from '@/features/billing/hooks/use-admin-promotions';
import type {
  PromotionTypeValue,
  PromotionStatusValue,
  PromotionRuleTypeValue,
  PromotionBenefitTypeValue,
  PromotionPlanRuleTypeValue,
  CreatePromotionRuleInput,
  CreatePromotionBenefitInput,
  SetPromotionPlanRuleInput,
  AdminPromotionDetail,
} from '@/features/billing/types';
import { ApiClientError } from '@/lib/api-client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// ─── Constants ───────────────────────────────────────────

const typeLabels: Record<PromotionTypeValue, string> = {
  sale: 'Sale',
  bonus: 'Bonus',
  trial_extension: 'Trial Extension',
  combined: 'Combined',
};

const statusLabels: Record<PromotionStatusValue, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  active: 'Active',
  paused: 'Paused',
  expired: 'Expired',
  archived: 'Archived',
};

const statusColors: Record<PromotionStatusValue, string> = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  paused: 'bg-yellow-100 text-yellow-700',
  expired: 'bg-red-100 text-red-700',
  archived: 'bg-gray-200 text-gray-500',
};

const ruleTypeLabels: Record<PromotionRuleTypeValue, string> = {
  date_range: 'Date Range',
  organization_type: 'Organization Type',
  subscription_status: 'Subscription Status',
  redemption_limit: 'Redemption Limit',
  new_subscriber: 'New Subscriber Only',
  billing_period: 'Billing Period',
  minimum_tier: 'Minimum Tier',
  stacking: 'Stacking',
};

const benefitTypeLabels: Record<PromotionBenefitTypeValue, string> = {
  percentage_discount: 'Percentage Discount',
  fixed_discount: 'Fixed Discount',
  bonus_credit: 'Bonus Credit',
  trial_extension: 'Trial Extension',
};

const planCodes = ['free', 'edu', 'pro', 'team', 'enterprise'];

// ─── Helper ──────────────────────────────────────────────

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 border-b py-2 last:border-0">
      <span className="w-40 shrink-0 text-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

function formatBenefitValue(b: {
  benefitType: PromotionBenefitTypeValue;
  discountValue: number | null;
  bonusEntitlementKey: string | null;
  bonusEntitlementValue: number | null;
  bonusDurationDays: number | null;
  trialExtensionDays: number | null;
}) {
  switch (b.benefitType) {
    case 'percentage_discount':
      return `${b.discountValue}% off`;
    case 'fixed_discount':
      return `PHP ${((b.discountValue ?? 0) / 100).toFixed(2)} off`;
    case 'bonus_credit':
      return `+${b.bonusEntitlementValue} ${b.bonusEntitlementKey} for ${b.bonusDurationDays}d`;
    case 'trial_extension':
      return `+${b.trialExtensionDays} trial days`;
    default:
      return String(b.discountValue);
  }
}

// ─── Schemas ─────────────────────────────────────────────

const editSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  internalNotes: z.string().max(1000).optional(),
  priority: z.coerce.number().min(0).max(9999),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  maxRedemptions: z.coerce.number().min(0).optional(),
  maxRedemptionsPerOrg: z.coerce.number().min(1),
  isStackableWithCoupons: z.boolean(),
  isStackableWithPromos: z.boolean(),
  isDisplayedOnPricing: z.boolean(),
});

type EditFormData = z.infer<typeof editSchema>;

// ─── Page Component ──────────────────────────────────────

export default function PromotionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { data: promo, isLoading } = useAdminPromotion(id);
  const updateMut = useUpdatePromotion();
  const archiveMut = useArchivePromotion();
  const activateMut = useActivatePromotion();
  const pauseMut = usePausePromotion();

  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!promo) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>Promotion not found</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin/promotions">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{promo.name}</h1>
            <p className="text-sm text-muted-foreground">{promo.slug}</p>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[promo.status] ?? ''}`}
          >
            {statusLabels[promo.status] ?? promo.status}
          </span>
          <Badge variant="outline">
            {typeLabels[promo.promotionType] ?? promo.promotionType}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {(promo.status === 'draft' || promo.status === 'scheduled' || promo.status === 'paused') && (
            <Button
              size="sm"
              onClick={async () => {
                try {
                  await activateMut.mutateAsync(id);
                } catch (err) {
                  setError(err instanceof ApiClientError ? err.message : 'Failed to activate');
                }
              }}
            >
              <Play className="mr-1 size-3" /> Activate
            </Button>
          )}
          {promo.status === 'active' && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await pauseMut.mutateAsync(id);
                } catch (err) {
                  setError(err instanceof ApiClientError ? err.message : 'Failed to pause');
                }
              }}
            >
              <Pause className="mr-1 size-3" /> Pause
            </Button>
          )}
          {promo.status !== 'archived' && (
            <Button
              size="sm"
              variant="destructive"
              onClick={async () => {
                try {
                  await archiveMut.mutateAsync(id);
                  router.push('/admin/promotions');
                } catch (err) {
                  setError(err instanceof ApiClientError ? err.message : 'Failed to archive');
                }
              }}
            >
              <Archive className="mr-1 size-3" /> Archive
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Stats */}
      {promo.stats && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total Redemptions</p>
              <p className="text-2xl font-bold">{promo.stats.totalRedemptions}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Applied</p>
              <p className="text-2xl font-bold text-green-600">{promo.stats.appliedCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Revoked</p>
              <p className="text-2xl font-bold text-red-600">{promo.stats.revokedCount}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="rules">
            Rules {promo.rules?.length ? `(${promo.rules.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="benefits">
            Benefits {promo.benefits?.length ? `(${promo.benefits.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="plan-rules">
            Plan Rules {promo.planRules?.length ? `(${promo.planRules.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="redemptions">Redemptions</TabsTrigger>
        </TabsList>

        {/* Details Tab */}
        <TabsContent value="details">
          <DetailsTab
            promo={promo}
            editing={editing}
            setEditing={setEditing}
            error={error}
            setError={setError}
            updateMut={updateMut}
          />
        </TabsContent>

        {/* Rules Tab */}
        <TabsContent value="rules">
          <RulesTab promoId={id} rules={promo.rules ?? []} setError={setError} />
        </TabsContent>

        {/* Benefits Tab */}
        <TabsContent value="benefits">
          <BenefitsTab promoId={id} benefits={promo.benefits ?? []} setError={setError} />
        </TabsContent>

        {/* Plan Rules Tab */}
        <TabsContent value="plan-rules">
          <PlanRulesTab promoId={id} planRules={promo.planRules ?? []} setError={setError} />
        </TabsContent>

        {/* Redemptions Tab */}
        <TabsContent value="redemptions">
          <RedemptionsTab promoId={id} setError={setError} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Details Tab ─────────────────────────────────────────

function DetailsTab({
  promo,
  editing,
  setEditing,
  error,
  setError,
  updateMut,
}: {
  promo: AdminPromotionDetail;
  editing: boolean;
  setEditing: (v: boolean) => void;
  error: string | null;
  setError: (v: string | null) => void;
  updateMut: ReturnType<typeof useUpdatePromotion>;
}) {
  const form = useForm<EditFormData>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: promo.name,
      description: promo.description ?? '',
      internalNotes: promo.internalNotes ?? '',
      priority: promo.priority,
      startsAt: promo.startsAt ? promo.startsAt.slice(0, 16) : '',
      endsAt: promo.endsAt ? promo.endsAt.slice(0, 16) : '',
      maxRedemptions: promo.maxRedemptions ?? 0,
      maxRedemptionsPerOrg: promo.maxRedemptionsPerOrg,
      isStackableWithCoupons: promo.isStackableWithCoupons,
      isStackableWithPromos: promo.isStackableWithPromos,
      isDisplayedOnPricing: promo.isDisplayedOnPricing,
    },
  });

  const onSave = async (values: EditFormData) => {
    setError(null);
    try {
      await updateMut.mutateAsync({
        id: promo.id,
        data: {
          ...values,
          startsAt: values.startsAt || undefined,
          endsAt: values.endsAt || undefined,
          maxRedemptions: values.maxRedemptions || undefined,
        },
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to update');
    }
  };

  if (!editing) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Promotion Details</CardTitle>
          {promo.status !== 'archived' && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="mr-1 size-3" /> Edit
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <InfoRow label="Name">{promo.name}</InfoRow>
          <InfoRow label="Slug">{promo.slug}</InfoRow>
          <InfoRow label="Description">{promo.description || '—'}</InfoRow>
          <InfoRow label="Internal Notes">{promo.internalNotes || '—'}</InfoRow>
          <InfoRow label="Priority">{promo.priority}</InfoRow>
          <InfoRow label="Starts At">
            {promo.startsAt ? new Date(promo.startsAt).toLocaleString() : '—'}
          </InfoRow>
          <InfoRow label="Ends At">
            {promo.endsAt ? new Date(promo.endsAt).toLocaleString() : '—'}
          </InfoRow>
          <InfoRow label="Max Redemptions">{promo.maxRedemptions ?? 'Unlimited'}</InfoRow>
          <InfoRow label="Max Per Org">{promo.maxRedemptionsPerOrg}</InfoRow>
          <InfoRow label="Stackable w/ Coupons">{promo.isStackableWithCoupons ? 'Yes' : 'No'}</InfoRow>
          <InfoRow label="Stackable w/ Promos">{promo.isStackableWithPromos ? 'Yes' : 'No'}</InfoRow>
          <InfoRow label="Shown on Pricing">{promo.isDisplayedOnPricing ? 'Yes' : 'No'}</InfoRow>
          <InfoRow label="Created">{new Date(promo.createdAt).toLocaleString()}</InfoRow>
          <InfoRow label="Updated">{new Date(promo.updatedAt).toLocaleString()}</InfoRow>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Edit Promotion</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            <X className="mr-1 size-3" /> Cancel
          </Button>
          <Button size="sm" onClick={form.handleSubmit(onSave)} disabled={updateMut.isPending}>
            <Save className="mr-1 size-3" /> {updateMut.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input {...form.register('name')} />
          </div>
          <div className="space-y-2">
            <Label>Priority</Label>
            <Input type="number" {...form.register('priority')} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Description</Label>
          <Textarea {...form.register('description')} rows={2} />
        </div>
        <div className="space-y-2">
          <Label>Internal Notes</Label>
          <Textarea {...form.register('internalNotes')} rows={2} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Starts At</Label>
            <Input type="datetime-local" {...form.register('startsAt')} />
          </div>
          <div className="space-y-2">
            <Label>Ends At</Label>
            <Input type="datetime-local" {...form.register('endsAt')} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Max Redemptions (0 = unlimited)</Label>
            <Input type="number" {...form.register('maxRedemptions')} />
          </div>
          <div className="space-y-2">
            <Label>Max Per Org</Label>
            <Input type="number" {...form.register('maxRedemptionsPerOrg')} />
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch
              checked={form.watch('isStackableWithCoupons')}
              onCheckedChange={(v) => form.setValue('isStackableWithCoupons', v)}
            />
            <Label>Stackable with Coupons</Label>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={form.watch('isStackableWithPromos')}
              onCheckedChange={(v) => form.setValue('isStackableWithPromos', v)}
            />
            <Label>Stackable with Other Promotions</Label>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={form.watch('isDisplayedOnPricing')}
              onCheckedChange={(v) => form.setValue('isDisplayedOnPricing', v)}
            />
            <Label>Displayed on Pricing Page</Label>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Rules Tab ───────────────────────────────────────────

function RulesTab({
  promoId,
  rules,
  setError,
}: {
  promoId: string;
  rules: { id: string; ruleType: PromotionRuleTypeValue; configuration: Record<string, unknown>; ordering: number; isActive: boolean }[];
  setError: (v: string | null) => void;
}) {
  const setRulesMut = useSetPromotionRules();
  const [addOpen, setAddOpen] = useState(false);
  const [newRuleType, setNewRuleType] = useState<PromotionRuleTypeValue>('date_range');
  const [newConfig, setNewConfig] = useState('{}');

  const handleAddRule = async () => {
    setError(null);
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(newConfig);
    } catch {
      setError('Invalid JSON in configuration');
      return;
    }
    const updatedRules: CreatePromotionRuleInput[] = [
      ...rules.map((r) => ({
        ruleType: r.ruleType,
        configuration: r.configuration,
        ordering: r.ordering,
        isActive: r.isActive,
      })),
      { ruleType: newRuleType, configuration: config, ordering: rules.length, isActive: true },
    ];
    try {
      await setRulesMut.mutateAsync({ promotionId: promoId, rules: updatedRules });
      setAddOpen(false);
      setNewConfig('{}');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to set rules');
    }
  };

  const handleRemoveRule = async (index: number) => {
    setError(null);
    const updatedRules: CreatePromotionRuleInput[] = rules
      .filter((_, i) => i !== index)
      .map((r, i) => ({
        ruleType: r.ruleType,
        configuration: r.configuration,
        ordering: i,
        isActive: r.isActive,
      }));
    try {
      await setRulesMut.mutateAsync({ promotionId: promoId, rules: updatedRules });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to remove rule');
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Eligibility Rules</CardTitle>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1 size-3" /> Add Rule
        </Button>
      </CardHeader>
      <CardContent>
        {rules.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No rules configured. All users are eligible.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Rule Type</TableHead>
                <TableHead>Configuration</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule, i) => (
                <TableRow key={rule.id}>
                  <TableCell className="font-mono text-xs">{rule.ordering}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {ruleTypeLabels[rule.ruleType] ?? rule.ruleType}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs">
                      {JSON.stringify(rule.configuration).slice(0, 80)}
                    </code>
                  </TableCell>
                  <TableCell>
                    {rule.isActive ? (
                      <Badge variant="default">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleRemoveRule(i)}
                      disabled={setRulesMut.isPending}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Eligibility Rule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Rule Type</Label>
              <Select
                value={newRuleType}
                onValueChange={(v) => setNewRuleType(v as PromotionRuleTypeValue)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ruleTypeLabels) as PromotionRuleTypeValue[]).map((rt) => (
                    <SelectItem key={rt} value={rt}>
                      {ruleTypeLabels[rt]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Configuration (JSON)</Label>
              <Textarea
                value={newConfig}
                onChange={(e) => setNewConfig(e.target.value)}
                rows={4}
                placeholder='{"startDate": "2026-04-01", "endDate": "2026-06-30"}'
                className="font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddRule} disabled={setRulesMut.isPending}>
              {setRulesMut.isPending ? 'Adding...' : 'Add Rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Benefits Tab ────────────────────────────────────────

function BenefitsTab({
  promoId,
  benefits,
  setError,
}: {
  promoId: string;
  benefits: {
    id: string;
    benefitType: PromotionBenefitTypeValue;
    discountValue: number | null;
    bonusEntitlementKey: string | null;
    bonusEntitlementValue: number | null;
    bonusDurationDays: number | null;
    trialExtensionDays: number | null;
    appliesToBillingPeriod: string;
  }[];
  setError: (v: string | null) => void;
}) {
  const setBenefitsMut = useSetPromotionBenefits();
  const [addOpen, setAddOpen] = useState(false);
  const [benefitType, setBenefitType] = useState<PromotionBenefitTypeValue>('percentage_discount');
  const [discountValue, setDiscountValue] = useState('');
  const [bonusKey, setBonusKey] = useState('');
  const [bonusValue, setBonusValue] = useState('');
  const [bonusDays, setBonusDays] = useState('');
  const [trialDays, setTrialDays] = useState('');
  const [billingPeriod, setBillingPeriod] = useState<'any' | 'monthly' | 'annual'>('any');

  const handleAdd = async () => {
    setError(null);
    const newBenefit: CreatePromotionBenefitInput = {
      benefitType,
      appliesToBillingPeriod: billingPeriod,
    };
    if (benefitType === 'percentage_discount' || benefitType === 'fixed_discount') {
      newBenefit.discountValue = Number(discountValue);
    }
    if (benefitType === 'bonus_credit') {
      newBenefit.bonusEntitlementKey = bonusKey;
      newBenefit.bonusEntitlementValue = Number(bonusValue);
      newBenefit.bonusDurationDays = Number(bonusDays);
    }
    if (benefitType === 'trial_extension') {
      newBenefit.trialExtensionDays = Number(trialDays);
    }

    const allBenefits: CreatePromotionBenefitInput[] = [
      ...benefits.map((b) => ({
        benefitType: b.benefitType,
        discountValue: b.discountValue ?? undefined,
        bonusEntitlementKey: b.bonusEntitlementKey ?? undefined,
        bonusEntitlementValue: b.bonusEntitlementValue ?? undefined,
        bonusDurationDays: b.bonusDurationDays ?? undefined,
        trialExtensionDays: b.trialExtensionDays ?? undefined,
        appliesToBillingPeriod: b.appliesToBillingPeriod as 'any' | 'monthly' | 'annual',
      })),
      newBenefit,
    ];

    try {
      await setBenefitsMut.mutateAsync({ promotionId: promoId, benefits: allBenefits });
      setAddOpen(false);
      setDiscountValue('');
      setBonusKey('');
      setBonusValue('');
      setBonusDays('');
      setTrialDays('');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to set benefits');
    }
  };

  const handleRemove = async (index: number) => {
    setError(null);
    const updated: CreatePromotionBenefitInput[] = benefits
      .filter((_, i) => i !== index)
      .map((b) => ({
        benefitType: b.benefitType,
        discountValue: b.discountValue ?? undefined,
        bonusEntitlementKey: b.bonusEntitlementKey ?? undefined,
        bonusEntitlementValue: b.bonusEntitlementValue ?? undefined,
        bonusDurationDays: b.bonusDurationDays ?? undefined,
        trialExtensionDays: b.trialExtensionDays ?? undefined,
        appliesToBillingPeriod: b.appliesToBillingPeriod as 'any' | 'monthly' | 'annual',
      }));
    try {
      await setBenefitsMut.mutateAsync({ promotionId: promoId, benefits: updated });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to remove benefit');
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Benefits</CardTitle>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1 size-3" /> Add Benefit
        </Button>
      </CardHeader>
      <CardContent>
        {benefits.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No benefits configured yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Billing Period</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {benefits.map((b, i) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <Badge variant="secondary">
                      {benefitTypeLabels[b.benefitType] ?? b.benefitType}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatBenefitValue(b)}</TableCell>
                  <TableCell className="capitalize">{b.appliesToBillingPeriod}</TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleRemove(i)}
                      disabled={setBenefitsMut.isPending}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Benefit</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Benefit Type</Label>
              <Select value={benefitType} onValueChange={(v) => setBenefitType(v as PromotionBenefitTypeValue)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(benefitTypeLabels) as PromotionBenefitTypeValue[]).map((bt) => (
                    <SelectItem key={bt} value={bt}>{benefitTypeLabels[bt]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {(benefitType === 'percentage_discount' || benefitType === 'fixed_discount') && (
              <div className="space-y-2">
                <Label>
                  {benefitType === 'percentage_discount' ? 'Percentage (1-100)' : 'Amount (centavos)'}
                </Label>
                <Input
                  type="number"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder={benefitType === 'percentage_discount' ? '20' : '10000'}
                />
              </div>
            )}

            {benefitType === 'bonus_credit' && (
              <>
                <div className="space-y-2">
                  <Label>Entitlement Key</Label>
                  <Input value={bonusKey} onChange={(e) => setBonusKey(e.target.value)} placeholder="aiAnswers" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Bonus Value</Label>
                    <Input type="number" value={bonusValue} onChange={(e) => setBonusValue(e.target.value)} placeholder="50" />
                  </div>
                  <div className="space-y-2">
                    <Label>Duration (days)</Label>
                    <Input type="number" value={bonusDays} onChange={(e) => setBonusDays(e.target.value)} placeholder="30" />
                  </div>
                </div>
              </>
            )}

            {benefitType === 'trial_extension' && (
              <div className="space-y-2">
                <Label>Extension (days)</Label>
                <Input type="number" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} placeholder="14" />
              </div>
            )}

            <div className="space-y-2">
              <Label>Applies To Billing Period</Label>
              <Select value={billingPeriod} onValueChange={(v) => setBillingPeriod(v as 'any' | 'monthly' | 'annual')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={setBenefitsMut.isPending}>
              {setBenefitsMut.isPending ? 'Adding...' : 'Add Benefit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Plan Rules Tab ──────────────────────────────────────

function PlanRulesTab({
  promoId,
  planRules,
  setError,
}: {
  promoId: string;
  planRules: { id: string; planCode: string; ruleType: PromotionPlanRuleTypeValue }[];
  setError: (v: string | null) => void;
}) {
  const setPlanRulesMut = useSetPromotionPlanRules();
  const [addOpen, setAddOpen] = useState(false);
  const [newPlanCode, setNewPlanCode] = useState('free');
  const [newRuleType, setNewRuleType] = useState<PromotionPlanRuleTypeValue>('include');

  const handleAdd = async () => {
    setError(null);
    const updated: SetPromotionPlanRuleInput[] = [
      ...planRules.map((r) => ({ planCode: r.planCode, ruleType: r.ruleType })),
      { planCode: newPlanCode, ruleType: newRuleType },
    ];
    try {
      await setPlanRulesMut.mutateAsync({ promotionId: promoId, rules: updated });
      setAddOpen(false);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to set plan rules');
    }
  };

  const handleRemove = async (index: number) => {
    setError(null);
    const updated: SetPromotionPlanRuleInput[] = planRules
      .filter((_, i) => i !== index)
      .map((r) => ({ planCode: r.planCode, ruleType: r.ruleType }));
    try {
      await setPlanRulesMut.mutateAsync({ promotionId: promoId, rules: updated });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to remove plan rule');
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Plan Rules</CardTitle>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1 size-3" /> Add Rule
        </Button>
      </CardHeader>
      <CardContent>
        {planRules.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No plan rules. Applies to all plans.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan Code</TableHead>
                <TableHead>Rule Type</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {planRules.map((rule, i) => (
                <TableRow key={rule.id}>
                  <TableCell className="font-mono">{rule.planCode}</TableCell>
                  <TableCell>
                    <Badge variant={rule.ruleType === 'include' ? 'default' : 'destructive'}>
                      {rule.ruleType}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleRemove(i)}
                      disabled={setPlanRulesMut.isPending}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Plan Rule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Plan Code</Label>
              <Select value={newPlanCode} onValueChange={setNewPlanCode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {planCodes.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Rule Type</Label>
              <Select value={newRuleType} onValueChange={(v) => setNewRuleType(v as PromotionPlanRuleTypeValue)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="include">Include</SelectItem>
                  <SelectItem value="exclude">Exclude</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={setPlanRulesMut.isPending}>
              {setPlanRulesMut.isPending ? 'Adding...' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Redemptions Tab ─────────────────────────────────────

function RedemptionsTab({
  promoId,
  setError,
}: {
  promoId: string;
  setError: (v: string | null) => void;
}) {
  const { data, isLoading } = usePromotionRedemptions(promoId);
  const revokeMut = useRevokePromotionRedemption();
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  const redemptions = data?.data ?? [];

  const handleRevoke = async () => {
    if (!revokeId || !revokeReason.trim()) return;
    setError(null);
    try {
      await revokeMut.mutateAsync({ redemptionId: revokeId, reason: revokeReason.trim() });
      setRevokeId(null);
      setRevokeReason('');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to revoke');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Redemption History</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading...</p>
        ) : redemptions.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No redemptions yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {redemptions.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Badge variant={r.status === 'applied' ? 'default' : 'destructive'}>
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[120px] truncate font-mono text-xs" title={r.organizationId}>
                    {r.organizationId.slice(0, 8)}...
                  </TableCell>
                  <TableCell className="max-w-[120px] truncate font-mono text-xs" title={r.userId}>
                    {r.userId.slice(0, 8)}...
                  </TableCell>
                  <TableCell>
                    {r.discountAmountApplied != null
                      ? `PHP ${(r.discountAmountApplied / 100).toFixed(2)}`
                      : '—'}
                  </TableCell>
                  <TableCell className="text-xs">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {r.status === 'applied' && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setRevokeId(r.id)}
                      >
                        Revoke
                      </Button>
                    )}
                    {r.status === 'revoked' && r.revokeReason && (
                      <span className="text-xs text-muted-foreground" title={r.revokeReason}>
                        {r.revokeReason.slice(0, 20)}...
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Revoke Dialog */}
      <AlertDialog open={!!revokeId} onOpenChange={(o) => !o && setRevokeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Redemption</AlertDialogTitle>
            <AlertDialogDescription>
              Provide a reason for revoking this redemption.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              placeholder="Reason for revocation..."
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              disabled={!revokeReason.trim() || revokeMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {revokeMut.isPending ? 'Revoking...' : 'Revoke'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
