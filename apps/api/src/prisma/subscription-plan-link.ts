/**
 * Keeps `subscriptions.plan_id` in sync with `subscriptions.plan_code`.
 *
 * `planCode` is the authoritative plan link — every entitlement resolver,
 * guard and quota check reads it. `planId` is a nullable convenience relation
 * used for display, joins and reporting. Twelve call sites create or upsert
 * subscriptions and every one of them writes `planCode` only, so `plan_id`
 * drifted to NULL on most rows (41 of 57 on prod, 33 of them active) after the
 * plans table was re-seeded with fresh UUIDs on 2026-07-13.
 *
 * Rather than edit twelve call sites (and miss the thirteenth), this resolves
 * `planId` from `planCode` at a single chokepoint: a Prisma query extension
 * registered on `PrismaService`, in the same spirit as the tenant-scoping
 * extension that lives beside it.
 *
 * Rules:
 * - No-op when the caller already supplies `planId` or a `plan` relation write.
 * - Best-effort: an unknown plan code, or any failure of the lookup, writes the
 *   row without `planId` and logs a warning. A failed signup is far worse than
 *   a NULL FK, and the backfill script can repair the row later.
 */

/** Resolves a plan code to a plan id, or null when no plan row carries it. */
export type PlanIdLookup = (planCode: string) => Promise<string | null>;

export interface PlanLinkLogger {
  warn(message: string): void;
}

type ExtensionArgs = {
  operation: string;
  args: Record<string, unknown>;
  query: (args: Record<string, unknown>) => unknown;
};

type SubscriptionData = Record<string, unknown>;

/**
 * True when this write already decides the plan relation itself — either by
 * setting a non-empty `planId` or by writing the `plan` relation directly.
 */
function hasExplicitPlanLink(data: SubscriptionData): boolean {
  const planId = data['planId'];
  if (typeof planId === 'string' && planId.length > 0) return true;
  return data['plan'] !== undefined;
}

/**
 * Builds the Prisma query-extension handler for Subscription writes.
 * Register it for `create`, `createMany`, `createManyAndReturn` and `upsert`.
 */
export function linkSubscriptionPlanId(lookupPlanId: PlanIdLookup, logger: PlanLinkLogger) {
  async function resolve(data: unknown): Promise<unknown> {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
    const row = data as SubscriptionData;
    if (hasExplicitPlanLink(row)) return row;

    const planCode = row['planCode'];
    if (typeof planCode !== 'string' || planCode.length === 0) return row;

    const planId = await lookupPlanId(planCode);
    if (!planId) {
      logger.warn(
        `Subscription written with plan_code "${planCode}" but no matching plan row; ` +
          'leaving plan_id NULL (planCode remains authoritative).',
      );
      return row;
    }
    return { ...row, planId };
  }

  async function resolveAll(data: unknown): Promise<unknown> {
    if (Array.isArray(data)) return Promise.all(data.map((entry) => resolve(entry)));
    return resolve(data);
  }

  return async ({ operation, args, query }: ExtensionArgs) => {
    try {
      switch (operation) {
        case 'create':
        case 'createMany':
        case 'createManyAndReturn':
          args['data'] = await resolveAll(args['data']);
          break;
        case 'upsert':
          args['create'] = await resolveAll(args['create']);
          break;
        default:
          break;
      }
    } catch (error) {
      // Never block the write. A missing plan_id is repairable; a failed
      // signup or checkout is not.
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to resolve plan_id from plan_code, writing row without it: ${message}`);
    }
    return query(args);
  };
}
