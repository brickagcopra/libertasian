'use client';

import { useState } from 'react';

import {
  useEffectiveEntitlements,
  useClearEntitlementsJsonKey,
} from '@/features/billing/hooks/use-admin-subscriptions';
import {
  ENTITLEMENT_LAYER_LABELS,
  ENTITLEMENT_PLATFORMS,
  formatEntitlementValue,
} from '@/features/billing/types';
import type {
  EffectiveEntitlementRow,
  EntitlementLayer,
  EntitlementPlatform,
} from '@/features/billing/types';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const layerBadgeVariant: Record<EntitlementLayer, string> = {
  plan: 'bg-gray-100 text-gray-700',
  subscription: 'bg-amber-100 text-amber-800',
  override: 'bg-purple-100 text-purple-700',
};

function overrideSummary(row: EffectiveEntitlementRow): string {
  if (row.activeOverrides.length === 0) return '—';
  return row.activeOverrides
    .map((o) => {
      const value =
        o.numericValue !== null
          ? formatEntitlementValue(o.numericValue)
          : o.booleanValue !== null
            ? formatEntitlementValue(o.booleanValue)
            : '—';
      return `${o.overrideType} ${value}`;
    })
    .join(', ');
}

export function EffectiveEntitlementsPanel({
  subscriptionId,
}: {
  subscriptionId: string;
}) {
  const [platform, setPlatform] = useState<EntitlementPlatform>('web');
  const [onlyOverridden, setOnlyOverridden] = useState(false);
  const [clearTarget, setClearTarget] = useState<EffectiveEntitlementRow | null>(
    null,
  );

  const { data: report, isLoading } = useEffectiveEntitlements(
    subscriptionId,
    platform,
  );
  const clearMutation = useClearEntitlementsJsonKey();

  const rows = (report?.keys ?? []).filter((row) =>
    onlyOverridden
      ? row.hasStoredValue || row.activeOverrides.length > 0
      : true,
  );
  const conflictCount = (report?.keys ?? []).filter(
    (row) => row.conflictsWithPlan,
  ).length;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Effective entitlements</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            What a client on this platform actually resolves to, and which of
            the three layers decided it.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border p-1">
          {ENTITLEMENT_PLATFORMS.map((p) => (
            <Button
              key={p.value}
              size="sm"
              variant={platform === p.value ? 'default' : 'ghost'}
              aria-pressed={platform === p.value}
              onClick={() => setPlatform(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading && (
          <p className="text-sm text-muted-foreground">
            Loading entitlements…
          </p>
        )}

        {report && !report.paywallEnforced && (
          <Alert>
            <AlertDescription>
              The paywall is <strong>not enforced</strong> for{' '}
              {ENTITLEMENT_PLATFORMS.find((p) => p.value === report.platform)
                ?.label ?? report.platform}
              , so none of the three layers is consulted for this platform — the
              effective column is the not-enforced fallback. The layers below
              still show what would apply where it is enforced.
            </AlertDescription>
          </Alert>
        )}

        {report && !report.isResolvedSubscription && (
          <Alert>
            <AlertDescription>
              This organization currently resolves against a different
              subscription
              {report.resolvedSubscriptionId
                ? ` (${report.resolvedSubscriptionId})`
                : ''}
              , so the effective column does not come from this row.
            </AlertDescription>
          </Alert>
        )}

        {report && conflictCount > 0 && (
          <Alert variant="destructive">
            <AlertDescription>
              {conflictCount} entitlement
              {conflictCount === 1 ? '' : 's'} on this subscription contradict
              {conflictCount === 1 ? 's' : ''} the{' '}
              <strong>{report.planCode}</strong> plan. A stored value wins over
              the plan, so these accounts do not get what the plan advertises.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyOverridden}
              onChange={(e) => setOnlyOverridden(e.target.checked)}
            />
            Only keys with a stored value or an override
          </label>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Stored</TableHead>
                <TableHead>Override</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Winning layer</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No entitlements to show.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow
                    key={row.key}
                    data-testid={`entitlement-row-${row.key}`}
                    className={row.conflictsWithPlan ? 'bg-destructive/5' : ''}
                  >
                    <TableCell className="font-mono text-xs">
                      {row.key}
                      {row.conflictsWithPlan && (
                        <p
                          className="mt-1 font-sans text-xs font-medium text-destructive"
                          data-testid={`entitlement-conflict-${row.key}`}
                        >
                          Conflict: plan grants{' '}
                          {formatEntitlementValue(row.planValue)}, this
                          subscription stores{' '}
                          {formatEntitlementValue(row.storedValue)}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {formatEntitlementValue(row.planValue)}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {row.hasStoredValue
                        ? formatEntitlementValue(row.storedValue)
                        : '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {overrideSummary(row)}
                    </TableCell>
                    <TableCell className="font-mono text-sm font-semibold">
                      {formatEntitlementValue(row.effectiveValue)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={layerBadgeVariant[row.winningLayer]}
                      >
                        {ENTITLEMENT_LAYER_LABELS[row.winningLayer]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.hasStoredValue && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setClearTarget(row)}
                        >
                          Clear
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <AlertDialog
        open={clearTarget !== null}
        onOpenChange={(open) => !open && setClearTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Clear stored {clearTarget?.key}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Removes {clearTarget?.key} from this subscription&apos;s
              entitlements_json. It will fall back to the plan value
              {clearTarget
                ? ` (${formatEntitlementValue(clearTarget.planValue)})`
                : ''}
              . Active entitlement overrides are unaffected and keep winning.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!clearTarget) return;
                clearMutation.mutate(
                  { id: subscriptionId, key: clearTarget.key },
                  { onSettled: () => setClearTarget(null) },
                );
              }}
            >
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
