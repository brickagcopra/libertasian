'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  PlayCircle,
  ArrowRightLeft,
  Route,
  Calculator,
  Percent,
  TicketIcon,
  MegaphoneIcon,
  BarChart3,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react';

import {
  useSimulateTransition,
  useSimulateLifecycle,
  useSimulatePricing,
  useSimulateProration,
  useSimulateCoupon,
  useSimulatePromotion,
  useSimulateRevenueImpact,
} from '@/features/billing/hooks/use-simulator';
import type {
  SimulateTransitionResult,
  SimulateLifecycleResult,
  SimulatePricingResult,
  SimulateProrationResult,
  SimulateCouponResult,
  SimulatePromotionResult,
  SimulateRevenueImpactResult,
} from '@/features/billing/types';
import { ApiClientError } from '@/lib/api-client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

// ─── Plan Codes ──────────────────────────────────────────

const PLAN_CODES = ['free', 'edu', 'pro', 'team', 'enterprise'] as const;
const STATES = [
  'provisioning',
  'trialing',
  'active',
  'past_due',
  'grace_period',
  'suspended',
  'pending_cancellation',
  'cancelled',
  'expired',
  'paused',
  'complimentary',
  'migrating',
  'terminated',
] as const;
const ACTIONS = [
  'PROVISION',
  'START_TRIAL',
  'CONVERT_TRIAL',
  'EXPIRE_TRIAL',
  'ACTIVATE',
  'PAYMENT_FAILED',
  'PAYMENT_RECOVERED',
  'GRACE_EXPIRE',
  'SUSPEND',
  'REQUEST_CANCEL',
  'CONFIRM_CANCEL',
  'EXPIRE',
  'UPGRADE',
  'DOWNGRADE',
  'PAUSE',
  'RESUME',
  'REACTIVATE',
] as const;

// ─── Page ────────────────────────────────────────────────

export default function SimulatorPage() {
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Billing Simulator</h1>
        <p className="text-sm text-muted-foreground">
          Test subscription state transitions, pricing calculations, and discount validations
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="transition">
        <TabsList className="flex-wrap">
          <TabsTrigger value="transition">
            <ArrowRightLeft className="mr-1 size-3" /> Transition
          </TabsTrigger>
          <TabsTrigger value="lifecycle">
            <Route className="mr-1 size-3" /> Lifecycle
          </TabsTrigger>
          <TabsTrigger value="pricing">
            <Calculator className="mr-1 size-3" /> Pricing
          </TabsTrigger>
          <TabsTrigger value="proration">
            <Percent className="mr-1 size-3" /> Proration
          </TabsTrigger>
          <TabsTrigger value="coupon">
            <TicketIcon className="mr-1 size-3" /> Coupon
          </TabsTrigger>
          <TabsTrigger value="promotion">
            <MegaphoneIcon className="mr-1 size-3" /> Promotion
          </TabsTrigger>
          <TabsTrigger value="revenue">
            <BarChart3 className="mr-1 size-3" /> Revenue Impact
          </TabsTrigger>
        </TabsList>

        <TabsContent value="transition">
          <TransitionSimulator setError={setError} />
        </TabsContent>
        <TabsContent value="lifecycle">
          <LifecycleSimulator setError={setError} />
        </TabsContent>
        <TabsContent value="pricing">
          <PricingSimulator setError={setError} />
        </TabsContent>
        <TabsContent value="proration">
          <ProrationSimulator setError={setError} />
        </TabsContent>
        <TabsContent value="coupon">
          <CouponSimulator setError={setError} />
        </TabsContent>
        <TabsContent value="promotion">
          <PromotionSimulator setError={setError} />
        </TabsContent>
        <TabsContent value="revenue">
          <RevenueImpactSimulator setError={setError} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Transition Simulator ────────────────────────────────

function TransitionSimulator({ setError }: { setError: (v: string | null) => void }) {
  const mut = useSimulateTransition();
  const [currentState, setCurrentState] = useState('active');
  const [action, setAction] = useState('REQUEST_CANCEL');
  const [result, setResult] = useState<SimulateTransitionResult | null>(null);

  const handleRun = async () => {
    setError(null);
    setResult(null);
    try {
      const r = await mut.mutateAsync({ currentState, action });
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Simulation failed');
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>State Transition</CardTitle>
          <CardDescription>Test a single state machine transition</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Current State</Label>
            <Select value={currentState} onValueChange={setCurrentState}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Action</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleRun} disabled={mut.isPending} className="w-full">
            <PlayCircle className="mr-2 size-4" /> {mut.isPending ? 'Simulating...' : 'Simulate'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Result</CardTitle>
        </CardHeader>
        <CardContent>
          {!result ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Run a simulation to see results</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {result.valid ? (
                  <CheckCircle2 className="size-5 text-green-600" />
                ) : (
                  <XCircle className="size-5 text-red-600" />
                )}
                <span className="font-medium">{result.valid ? 'Valid Transition' : 'Invalid Transition'}</span>
              </div>
              <div className="rounded bg-muted p-3 text-sm">
                <p><strong>{result.fromState}</strong> → <strong>{result.action}</strong> → <strong>{result.toState ?? '(none)'}</strong></p>
                <p className="mt-1">Has Access: {result.hasAccess ? 'Yes' : 'No'}</p>
              </div>
              {result.error && (
                <Alert variant="destructive">
                  <AlertDescription>{result.error}</AlertDescription>
                </Alert>
              )}
              {result.sideEffects.length > 0 && (
                <div>
                  <p className="mb-1 text-sm font-medium">Side Effects:</p>
                  <ul className="list-disc pl-5 text-sm">
                    {result.sideEffects.map((se, i) => (
                      <li key={i}><Badge variant="outline" className="mr-1">{se.type}</Badge>{se.description}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.validActionsFromNewState.length > 0 && (
                <div>
                  <p className="mb-1 text-sm font-medium">Valid Actions from New State:</p>
                  <div className="flex flex-wrap gap-1">
                    {result.validActionsFromNewState.map((a) => (
                      <Badge key={a} variant="secondary">{a}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Lifecycle Simulator ─────────────────────────────────

function LifecycleSimulator({ setError }: { setError: (v: string | null) => void }) {
  const mut = useSimulateLifecycle();
  const [startState, setStartState] = useState('provisioning');
  const [actions, setActions] = useState('PROVISION,START_TRIAL,CONVERT_TRIAL');
  const [result, setResult] = useState<SimulateLifecycleResult | null>(null);

  const handleRun = async () => {
    setError(null);
    setResult(null);
    const actionList = actions.split(',').map((a) => a.trim()).filter(Boolean);
    if (actionList.length === 0) { setError('Enter at least one action'); return; }
    try {
      const r = await mut.mutateAsync({ startingState: startState, actions: actionList });
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Simulation failed');
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Lifecycle Simulation</CardTitle>
          <CardDescription>Simulate a multi-step subscription lifecycle</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Starting State</Label>
            <Select value={startState} onValueChange={setStartState}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Actions (comma-separated)</Label>
            <Input
              value={actions}
              onChange={(e) => setActions(e.target.value)}
              placeholder="PROVISION,START_TRIAL,CONVERT_TRIAL"
            />
            <p className="text-xs text-muted-foreground">
              Available: {ACTIONS.join(', ')}
            </p>
          </div>
          <Button onClick={handleRun} disabled={mut.isPending} className="w-full">
            <PlayCircle className="mr-2 size-4" /> {mut.isPending ? 'Simulating...' : 'Simulate'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Result</CardTitle>
        </CardHeader>
        <CardContent>
          {!result ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Run a simulation to see results</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-4 text-sm">
                <span>Final: <strong>{result.finalState}</strong></span>
                <span>Access: {result.finalHasAccess ? 'Yes' : 'No'}</span>
                <span>{result.successfulSteps}/{result.totalSteps} steps OK</span>
                {result.failedAtStep != null && (
                  <Badge variant="destructive">Failed at step {result.failedAtStep}</Badge>
                )}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.steps.map((step) => (
                    <TableRow key={step.step}>
                      <TableCell className="font-mono">{step.step}</TableCell>
                      <TableCell className="font-mono text-xs">{step.action}</TableCell>
                      <TableCell>{step.fromState}</TableCell>
                      <TableCell>{step.toState ?? '—'}</TableCell>
                      <TableCell>
                        {step.valid ? (
                          <CheckCircle2 className="size-4 text-green-600" />
                        ) : (
                          <XCircle className="size-4 text-red-600" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Pricing Simulator ───────────────────────────────────

function PricingSimulator({ setError }: { setError: (v: string | null) => void }) {
  const mut = useSimulatePricing();
  const [orgId, setOrgId] = useState('');
  const [planCode, setPlanCode] = useState('pro');
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');
  const [couponCode, setCouponCode] = useState('');
  const [promotionId, setPromotionId] = useState('');
  const [result, setResult] = useState<SimulatePricingResult | null>(null);

  const handleRun = async () => {
    setError(null);
    setResult(null);
    if (!orgId.trim()) { setError('Organization ID is required'); return; }
    try {
      const r = await mut.mutateAsync({
        organizationId: orgId.trim(),
        planCode,
        billingPeriod,
        couponCode: couponCode.trim() || undefined,
        promotionId: promotionId.trim() || undefined,
      });
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Simulation failed');
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Pricing Breakdown</CardTitle>
          <CardDescription>Calculate full price breakdown for a plan</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Organization ID</Label>
            <Input value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="UUID" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Plan</Label>
              <Select value={planCode} onValueChange={setPlanCode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLAN_CODES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Billing Period</Label>
              <Select value={billingPeriod} onValueChange={(v) => setBillingPeriod(v as 'monthly' | 'annual')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Coupon Code (optional)</Label>
              <Input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="SUMMER20" />
            </div>
            <div className="space-y-2">
              <Label>Promotion ID (optional)</Label>
              <Input value={promotionId} onChange={(e) => setPromotionId(e.target.value)} placeholder="UUID" />
            </div>
          </div>
          <Button onClick={handleRun} disabled={mut.isPending} className="w-full">
            <PlayCircle className="mr-2 size-4" /> {mut.isPending ? 'Calculating...' : 'Calculate'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Result</CardTitle></CardHeader>
        <CardContent>
          {!result ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Run a simulation to see results</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4 rounded bg-muted p-4 text-center">
                <div>
                  <p className="text-xs text-muted-foreground">Base</p>
                  <p className="text-lg font-bold">PHP {(result.baseAmount / 100).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Discount</p>
                  <p className="text-lg font-bold text-red-600">-PHP {(result.discountAmount / 100).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Final</p>
                  <p className="text-lg font-bold text-green-600">PHP {(result.finalAmount / 100).toFixed(2)}</p>
                </div>
              </div>
              {result.lineItems?.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.lineItems.map((li, i) => (
                      <TableRow key={i}>
                        <TableCell><Badge variant="outline">{li.type}</Badge></TableCell>
                        <TableCell>{li.label}</TableCell>
                        <TableCell className="text-right">PHP {(li.amount / 100).toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Proration Simulator ─────────────────────────────────

function ProrationSimulator({ setError }: { setError: (v: string | null) => void }) {
  const mut = useSimulateProration();
  const [currentPlan, setCurrentPlan] = useState('edu');
  const [newPlan, setNewPlan] = useState('pro');
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [result, setResult] = useState<SimulateProrationResult | null>(null);

  const handleRun = async () => {
    setError(null);
    setResult(null);
    if (!periodStart || !periodEnd) { setError('Period start and end are required'); return; }
    try {
      const r = await mut.mutateAsync({
        currentPlanCode: currentPlan,
        newPlanCode: newPlan,
        billingPeriod,
        periodStart: new Date(periodStart).toISOString(),
        periodEnd: new Date(periodEnd).toISOString(),
      });
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Simulation failed');
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Proration Calculator</CardTitle>
          <CardDescription>Calculate mid-cycle upgrade/downgrade costs</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Current Plan</Label>
              <Select value={currentPlan} onValueChange={setCurrentPlan}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLAN_CODES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>New Plan</Label>
              <Select value={newPlan} onValueChange={setNewPlan}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLAN_CODES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Billing Period</Label>
            <Select value={billingPeriod} onValueChange={(v) => setBillingPeriod(v as 'monthly' | 'annual')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="annual">Annual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Period Start</Label>
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Period End</Label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
          </div>
          <Button onClick={handleRun} disabled={mut.isPending} className="w-full">
            <PlayCircle className="mr-2 size-4" /> {mut.isPending ? 'Calculating...' : 'Calculate'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Result</CardTitle></CardHeader>
        <CardContent>
          {!result ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Run a simulation to see results</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded bg-muted p-4 text-sm">
                <p><strong>{result.currentPlanCode}</strong> → <strong>{result.newPlanCode}</strong> ({result.billingPeriod})</p>
                <p className="mt-1">{result.daysRemaining} of {result.totalDays} days remaining</p>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-xs text-muted-foreground">Credit</p>
                  <p className="text-lg font-bold text-green-600">PHP {(result.creditAmount / 100).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Charge</p>
                  <p className="text-lg font-bold text-red-600">PHP {(result.chargeAmount / 100).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Net</p>
                  <p className="text-lg font-bold">PHP {(result.netAmount / 100).toFixed(2)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <p className="text-muted-foreground">Current Daily Rate:</p>
                <p>PHP {(result.currentDailyRate / 100).toFixed(2)}</p>
                <p className="text-muted-foreground">New Daily Rate:</p>
                <p>PHP {(result.newDailyRate / 100).toFixed(2)}</p>
                <p className="text-muted-foreground">Effective Date:</p>
                <p>{new Date(result.effectiveDate).toLocaleDateString()}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Coupon Simulator ────────────────────────────────────

function CouponSimulator({ setError }: { setError: (v: string | null) => void }) {
  const mut = useSimulateCoupon();
  const [couponCode, setCouponCode] = useState('');
  const [planCode, setPlanCode] = useState('pro');
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');
  const [orgId, setOrgId] = useState('');
  const [result, setResult] = useState<SimulateCouponResult | null>(null);

  const handleRun = async () => {
    setError(null);
    setResult(null);
    if (!couponCode.trim()) { setError('Coupon code is required'); return; }
    try {
      const r = await mut.mutateAsync({
        couponCode: couponCode.trim(),
        planCode,
        billingPeriod,
        organizationId: orgId.trim() || undefined,
      });
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Simulation failed');
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Coupon Validator</CardTitle>
          <CardDescription>Test coupon code validity and preview discount</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Coupon Code</Label>
            <Input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="SUMMER20" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Plan</Label>
              <Select value={planCode} onValueChange={setPlanCode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLAN_CODES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Billing Period</Label>
              <Select value={billingPeriod} onValueChange={(v) => setBillingPeriod(v as 'monthly' | 'annual')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Organization ID (optional)</Label>
            <Input value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="UUID" />
          </div>
          <Button onClick={handleRun} disabled={mut.isPending} className="w-full">
            <PlayCircle className="mr-2 size-4" /> {mut.isPending ? 'Validating...' : 'Validate'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Result</CardTitle></CardHeader>
        <CardContent>
          {!result ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Run a simulation to see results</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {result.valid ? (
                  <CheckCircle2 className="size-5 text-green-600" />
                ) : (
                  <XCircle className="size-5 text-red-600" />
                )}
                <span className="font-medium">{result.valid ? 'Valid Coupon' : 'Invalid Coupon'}</span>
              </div>
              {result.couponName && (
                <p className="text-sm"><strong>{result.couponName}</strong> ({result.discountType}: {result.discountValue})</p>
              )}
              {result.errors.length > 0 && (
                <div className="space-y-1">
                  {result.errors.map((e, i) => (
                    <Alert key={i} variant="destructive">
                      <AlertDescription>{e}</AlertDescription>
                    </Alert>
                  ))}
                </div>
              )}
              {result.discountPreview && (
                <div className="grid grid-cols-3 gap-4 rounded bg-muted p-4 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">Original</p>
                    <p className="font-bold">PHP {(result.discountPreview.originalAmount / 100).toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Discount</p>
                    <p className="font-bold text-red-600">-PHP {(result.discountPreview.discountAmount / 100).toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Final</p>
                    <p className="font-bold text-green-600">PHP {(result.discountPreview.finalAmount / 100).toFixed(2)}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Promotion Simulator ─────────────────────────────────

function PromotionSimulator({ setError }: { setError: (v: string | null) => void }) {
  const mut = useSimulatePromotion();
  const [promotionId, setPromotionId] = useState('');
  const [orgId, setOrgId] = useState('');
  const [planCode, setPlanCode] = useState('pro');
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');
  const [result, setResult] = useState<SimulatePromotionResult | null>(null);

  const handleRun = async () => {
    setError(null);
    setResult(null);
    if (!promotionId.trim() || !orgId.trim()) { setError('Promotion ID and Organization ID are required'); return; }
    try {
      const r = await mut.mutateAsync({
        promotionId: promotionId.trim(),
        organizationId: orgId.trim(),
        planCode,
        billingPeriod,
      });
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Simulation failed');
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Promotion Eligibility</CardTitle>
          <CardDescription>Check if an organization is eligible for a promotion</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Promotion ID</Label>
            <Input value={promotionId} onChange={(e) => setPromotionId(e.target.value)} placeholder="UUID" />
          </div>
          <div className="space-y-2">
            <Label>Organization ID</Label>
            <Input value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="UUID" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Plan</Label>
              <Select value={planCode} onValueChange={setPlanCode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLAN_CODES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Billing Period</Label>
              <Select value={billingPeriod} onValueChange={(v) => setBillingPeriod(v as 'monthly' | 'annual')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={handleRun} disabled={mut.isPending} className="w-full">
            <PlayCircle className="mr-2 size-4" /> {mut.isPending ? 'Checking...' : 'Check Eligibility'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Result</CardTitle></CardHeader>
        <CardContent>
          {!result ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Run a simulation to see results</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {result.eligible ? (
                  <CheckCircle2 className="size-5 text-green-600" />
                ) : (
                  <XCircle className="size-5 text-red-600" />
                )}
                <span className="font-medium">{result.eligible ? 'Eligible' : 'Not Eligible'}</span>
              </div>
              {result.errors.length > 0 && (
                <div className="space-y-1">
                  {result.errors.map((e, i) => (
                    <Alert key={i} variant="destructive">
                      <AlertDescription>{e}</AlertDescription>
                    </Alert>
                  ))}
                </div>
              )}
              {result.ruleResults.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rule</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.ruleResults.map((rr, i) => (
                      <TableRow key={i}>
                        <TableCell><Badge variant="outline">{rr.ruleType}</Badge></TableCell>
                        <TableCell>
                          {rr.passed ? (
                            <CheckCircle2 className="size-4 text-green-600" />
                          ) : (
                            <XCircle className="size-4 text-red-600" />
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{rr.reason ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {result.discountPreview && (
                <div className="grid grid-cols-3 gap-4 rounded bg-muted p-4 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">Original</p>
                    <p className="font-bold">PHP {(result.discountPreview.originalAmount / 100).toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Discount</p>
                    <p className="font-bold text-red-600">-PHP {(result.discountPreview.discountAmount / 100).toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Final</p>
                    <p className="font-bold text-green-600">PHP {(result.discountPreview.finalAmount / 100).toFixed(2)}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Revenue Impact Simulator ────────────────────────────

function RevenueImpactSimulator({ setError }: { setError: (v: string | null) => void }) {
  const mut = useSimulateRevenueImpact();
  const [sourceType, setSourceType] = useState<'coupon' | 'promotion'>('coupon');
  const [sourceId, setSourceId] = useState('');
  const [selectedPlans, setSelectedPlans] = useState<{ planCode: string; billingPeriod: 'monthly' | 'annual' }[]>([
    { planCode: 'edu', billingPeriod: 'monthly' },
    { planCode: 'pro', billingPeriod: 'monthly' },
    { planCode: 'pro', billingPeriod: 'annual' },
    { planCode: 'team', billingPeriod: 'monthly' },
  ]);
  const [result, setResult] = useState<SimulateRevenueImpactResult | null>(null);

  const handleRun = async () => {
    setError(null);
    setResult(null);
    if (!sourceId.trim()) { setError(`${sourceType === 'coupon' ? 'Coupon' : 'Promotion'} ID is required`); return; }
    try {
      const r = await mut.mutateAsync({
        couponId: sourceType === 'coupon' ? sourceId.trim() : undefined,
        promotionId: sourceType === 'promotion' ? sourceId.trim() : undefined,
        plans: selectedPlans,
      });
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Simulation failed');
    }
  };

  const addPlan = () => {
    setSelectedPlans((p) => [...p, { planCode: 'pro', billingPeriod: 'monthly' }]);
  };

  const removePlan = (index: number) => {
    setSelectedPlans((p) => p.filter((_, i) => i !== index));
  };

  const updatePlan = (index: number, field: 'planCode' | 'billingPeriod', value: string) => {
    setSelectedPlans((p) =>
      p.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Revenue Impact Analysis</CardTitle>
          <CardDescription>Estimate revenue impact of a coupon or promotion across plans</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Source Type</Label>
              <Select value={sourceType} onValueChange={(v) => setSourceType(v as 'coupon' | 'promotion')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="coupon">Coupon</SelectItem>
                  <SelectItem value="promotion">Promotion</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{sourceType === 'coupon' ? 'Coupon ID' : 'Promotion ID'}</Label>
              <Input value={sourceId} onChange={(e) => setSourceId(e.target.value)} placeholder="UUID" />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Plans to Analyze</Label>
              <Button type="button" size="sm" variant="outline" onClick={addPlan}>Add</Button>
            </div>
            <div className="space-y-2">
              {selectedPlans.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={p.planCode} onValueChange={(v) => updatePlan(i, 'planCode', v)}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PLAN_CODES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={p.billingPeriod} onValueChange={(v) => updatePlan(i, 'billingPeriod', v)}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="annual">Annual</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="button" size="icon" variant="ghost" onClick={() => removePlan(i)}>
                    <XCircle className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <Button onClick={handleRun} disabled={mut.isPending || selectedPlans.length === 0} className="w-full">
            <PlayCircle className="mr-2 size-4" /> {mut.isPending ? 'Analyzing...' : 'Analyze Impact'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Result</CardTitle></CardHeader>
        <CardContent>
          {!result ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Run a simulation to see results</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded bg-muted p-3 text-sm">
                <p><strong>{result.sourceName}</strong> ({result.sourceType})</p>
                <p className="text-xs text-muted-foreground">
                  Simulated at {new Date(result.simulatedAt).toLocaleString()}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 text-center">
                <div>
                  <p className="text-xs text-muted-foreground">Total Base</p>
                  <p className="text-lg font-bold">PHP {(result.totalBaseRevenue / 100).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total After Discount</p>
                  <p className="text-lg font-bold text-green-600">PHP {(result.totalDiscountedRevenue / 100).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Discount</p>
                  <p className="text-lg font-bold text-red-600">-PHP {(result.totalDiscountAmount / 100).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Avg Discount %</p>
                  <p className="text-lg font-bold">{result.averageDiscountPercentage.toFixed(1)}%</p>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plan</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                    <TableHead className="text-right">Final</TableHead>
                    <TableHead className="text-right">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.plans.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono">{p.planCode}</TableCell>
                      <TableCell>{p.billingPeriod}</TableCell>
                      <TableCell className="text-right">PHP {(p.basePriceAmount / 100).toFixed(2)}</TableCell>
                      <TableCell className="text-right text-red-600">-PHP {(p.discountAmount / 100).toFixed(2)}</TableCell>
                      <TableCell className="text-right font-medium">PHP {(p.finalAmount / 100).toFixed(2)}</TableCell>
                      <TableCell className="text-right">{p.discountPercentage.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
