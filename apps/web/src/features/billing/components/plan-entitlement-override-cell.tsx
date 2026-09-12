'use client';

import { useState } from 'react';

import {
  useStoredEntitlementKeyCounts,
  usePruneEntitlementsJson,
} from '@/features/billing/hooks/use-admin-subscriptions';
import { formatEntitlementValue } from '@/features/billing/types';
import type { PruneEntitlementsJsonResult } from '@/features/billing/types';

import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * "N subscriptions override this key", on the plan editor.
 *
 * This is the screen where the contradiction gets noticed: the plan says
 * aiAnswers 15 and /pricing advertises it, while subscriptions quietly store
 * their own value that wins. The count links straight to the prune action for
 * that key and value.
 *
 * The counts query is shared — TanStack dedupes it by key, so one cell per row
 * still makes a single request.
 */
export function PlanEntitlementOverrideCell({
  planCode,
  entitlementKey,
  planValue,
}: {
  planCode: string;
  entitlementKey: string;
  planValue: number | boolean | null;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<PruneEntitlementsJsonResult | null>(null);

  const { data: counts } = useStoredEntitlementKeyCounts(planCode);
  const pruneMutation = usePruneEntitlementsJson();

  const stats = counts?.[entitlementKey];

  if (!stats || stats.count === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  return (
    <>
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-amber-700"
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
      >
        {stats.count} subscription{stats.count === 1 ? '' : 's'} override this
        key
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Stored overrides for{' '}
              <span className="font-mono">{entitlementKey}</span>
            </DialogTitle>
            <DialogDescription>
              These {planCode} subscriptions store their own value in
              entitlements_json, which wins over the plan&apos;s{' '}
              {formatEntitlementValue(planValue)}. Clearing a value makes those
              accounts fall back to the plan. Entitlement overrides are a
              separate layer and are not touched.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {stats.values.map((bucket) => {
              const conflicts = bucket.value !== planValue;
              return (
                <div
                  key={JSON.stringify(bucket.value)}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <p className="font-mono text-sm">
                      {formatEntitlementValue(bucket.value)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {bucket.count} subscription
                      {bucket.count === 1 ? '' : 's'}
                      {conflicts
                        ? ` — plan grants ${formatEntitlementValue(planValue)}`
                        : ' — matches the plan'}
                    </p>
                  </div>
                  <Button
                    variant={conflicts ? 'destructive' : 'outline'}
                    size="sm"
                    disabled={pruneMutation.isPending || bucket.value === null}
                    onClick={() => {
                      if (bucket.value === null) return;
                      pruneMutation.mutate(
                        { key: entitlementKey, valueEquals: bucket.value },
                        { onSuccess: (data) => setResult(data) },
                      );
                    }}
                  >
                    Clear from {bucket.count}
                  </Button>
                </div>
              );
            })}
          </div>

          {result && (
            <Alert>
              <AlertDescription>
                Cleared <span className="font-mono">{result.key}</span> ={' '}
                {formatEntitlementValue(
                  typeof result.valueEquals === 'string'
                    ? null
                    : result.valueEquals,
                )}{' '}
                from {result.affectedCount} subscription
                {result.affectedCount === 1 ? '' : 's'}.
              </AlertDescription>
            </Alert>
          )}

          {pruneMutation.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                Prune failed. Nothing was changed.
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
