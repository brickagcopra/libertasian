import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { BillingService } from './billing.service';
import { WebhookController } from './webhook.controller';
import { XenditService } from './xendit.service';

const CALLBACK_TOKEN = 'tok';

/**
 * End-to-end regression guard for the double period-advance bug.
 *
 * Wires the REAL WebhookController + REAL BillingService together over
 * stateful in-memory fakes for Prisma and Redis, so the full path — event
 * routing, controller idempotency, cycle-id idempotency and period math — runs
 * exactly as in production. The unit specs mock the service out of the
 * controller (and vice versa), which is precisely why the original bug shipped
 * with green CI: no test crossed the routing boundary with a shared,
 * stateful backing store.
 *
 * INVARIANT UNDER TEST: a charged cycle advances currentPeriodEnd EXACTLY ONCE
 * and records EXACTLY ONE subscription Payment. Activation + the first cycle net
 * EXACTLY ONE period. `payment.succeeded` (the lower-level capture that fires
 * alongside `recurring.cycle.succeeded` with a different id) never advances.
 * Replays of any single event never advance again.
 */

interface SubRow {
  id: string;
  organizationId: string;
  planCode: string;
  billingPeriod: string;
  status: string;
  provider: string;
  providerSubscriptionId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

interface PaymentRow {
  id: string;
  organizationId: string;
  subscriptionId: string;
  providerInvoiceId: string;
  amount: number;
  currency: string;
  status: string;
  [key: string]: unknown;
}

/** Minimal stateful Prisma stand-in covering only what the two handlers touch. */
class FakePrisma {
  subs = new Map<string, SubRow>();
  payments: PaymentRow[] = [];
  private paySeq = 0;

  payment = {
    findUnique: async ({ where }: { where: { providerInvoiceId: string } }) =>
      this.payments.find((p) => p.providerInvoiceId === where.providerInvoiceId) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `pay-${++this.paySeq}`, ...data } as PaymentRow;
      this.payments.push(row);
      return row;
    },
    update: async () => ({}),
  };

  subscription = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      const wanted = where['providerSubscriptionId'];
      if (wanted === undefined) return null;
      for (const s of this.subs.values()) {
        if (s.providerSubscriptionId === wanted) return s;
      }
      return null;
    },
    findUnique: async ({ where }: { where: { id: string } }) => this.subs.get(where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<SubRow> }) => {
      const row = this.subs.get(where.id)!;
      Object.assign(row, data);
      return row;
    },
    create: async () => ({}),
    updateMany: async () => ({}),
  };

  paymentMethod = {
    upsert: async () => ({}),
    findFirst: async () => null,
  };

  // Lifecycle-email surface (renewal reminder scheduling + recurring receipt).
  // organization.findUnique → null means no billing owner, so the receipt email
  // path is a no-op here; the reminder events are recorded but unasserted.
  invoice = {
    findFirst: async () => null,
    create: async ({ data }: { data: Record<string, unknown> }) => data,
  };

  organization = { findUnique: async () => null };

  lifecycleEvents: Record<string, unknown>[] = [];
  subscriptionLifecycleEvent = {
    updateMany: async () => ({ count: 0 }),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      this.lifecycleEvents.push(data);
      return data;
    },
  };

  // Handlers run their writes inside a single $transaction; the fake client IS
  // the transaction client (writes apply immediately, mirroring commit).
  $transaction = async <T>(cb: (tx: this) => Promise<T>): Promise<T> => cb(this);
}

/** In-memory Redis stand-in so controller idempotency keys behave realistically. */
class FakeRedis {
  store = new Map<string, string>();
  get = async (k: string) => this.store.get(k) ?? null;
  set = async (k: string, v: string) => {
    this.store.set(k, v);
  };
  del = async (k: string) => {
    this.store.delete(k);
  };
}

// Real Subscription ids are UUIDs — BillingService drops non-UUID reference_ids
// (Xendit test webhooks) before hitting the UUID `id` column, so the seeded sub
// must use the real shape for the reference_id link-back to work.
const SUB_ID = '6d5a4e3c-2b1f-4a8e-9c7d-5e4f3a2b1c0d';

const noopAudit = { log: jest.fn().mockResolvedValue(undefined) };
const noopLifecycle = { executeTransition: jest.fn().mockResolvedValue({ success: true }) };
const noopEntitlement = { invalidateEntitlementCache: jest.fn().mockResolvedValue(undefined) };
const noopUsageQuota = { resetQuotasForBillingCycle: jest.fn().mockResolvedValue(undefined) };

/** Build a fake RawBodyRequest carrying the given JSON body. */
function reqWith(body: unknown): RawBodyRequest<Request> {
  return {
    rawBody: Buffer.from(JSON.stringify(body)),
    headers: { 'x-callback-token': CALLBACK_TOKEN },
  } as unknown as RawBodyRequest<Request>;
}

/**
 * The REAL adapter, so the raw Xendit payload shapes above are translated by
 * production code. Stubbing normalization here would hide exactly the kind of
 * routing mistake this regression guard exists to catch.
 */
const xenditAdapter = new XenditService({
  get: (key: string, fallback?: string) =>
    key === 'XENDIT_WEBHOOK_CALLBACK_TOKEN' ? CALLBACK_TOKEN : (fallback ?? ''),
} as never);

function buildStack(opts: { billingPeriod?: string } = {}) {
  const prisma = new FakePrisma();
  const redis = new FakeRedis();

  // Seed a provisioning subscription linked back via reference_id (its own id),
  // exactly as createCheckout leaves it before plan.activated arrives.
  prisma.subs.set(SUB_ID, {
    id: SUB_ID,
    organizationId: 'org-1',
    planCode: 'pro',
    billingPeriod: opts.billingPeriod ?? 'monthly',
    status: 'provisioning',
    provider: 'xendit',
    providerSubscriptionId: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
  });

  const billing = new BillingService(
    prisma as never, // prisma
    xenditAdapter, // paymentProvider (port)
    {} as never, // subscriptionsService (unused on this path)
    noopAudit as never, // auditService
    {} as never, // pricingEngine
    {} as never, // couponService
    {} as never, // promotionService
    noopLifecycle as never, // lifecycleService
    {} as never, // notificationsService
    noopEntitlement as never, // entitlementService
    noopUsageQuota as never, // usageQuotaService
    { get: (_k: string, d: unknown) => d } as never, // config (ConfigService)
  );

  const controller = new WebhookController(
    xenditAdapter,
    billing,
    noopAudit as never,
    redis as never,
  );

  return { prisma, redis, controller };
}

const monthsApart = (a: Date, b: Date): number =>
  (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());

describe('recurring billing — double period-advance regression (controller ⇄ service)', () => {
  /**
   * THE CLOCK IS PINNED, and that is load-bearing.
   *
   * This suite used to pass or fail depending on the calendar. On 2026-08-31 it
   * failed in CI — `Expected 1, Received 2` — because `setMonth(getMonth() + 1)`
   * rolled Aug 31 forward to Oct 1 (Sep has no 31st), advancing the period by
   * TWO months and recording a second Payment. On any other date it passed. A
   * test that goes green tomorrow because the month turned over is not a fixed
   * test, so the date is now an input rather than ambient state.
   *
   * Pinned to noon LOCAL on the 31st, constructed with the local-time `Date`
   * ctor deliberately: the production code advances periods with local-time
   * getters/setters, so only a local 31st exercises the clamp. Pinning the UTC
   * instant CI happened to fail at (2026-08-31T00:19Z) would reproduce the bug
   * on a UTC runner and silently NOT reproduce it anywhere west of Greenwich,
   * where that instant is still Aug 30. There is a test below pinned to that
   * exact instant as well, for the record.
   *
   * Only `Date` is faked. Faking the timer APIs would hang the awaited webhook
   * handlers, which never advance a timer.
   */
  const REAL_TIMERS_ONLY = [
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'setImmediate',
    'clearImmediate',
    'nextTick',
    'queueMicrotask',
    'performance',
    'hrtime',
  ] as const;

  const pinClockTo = (when: Date): void => {
    jest.useFakeTimers({
      now: when,
      doNotFake: [...REAL_TIMERS_ONLY],
    });
  };

  beforeEach(() => {
    // Local Aug 31 in whatever zone the runner is in.
    pinClockTo(new Date(2026, 7, 31, 12, 0, 0));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const activated = reqWith({
    event: 'recurring.plan.activated',
    data: { id: 'repl_1', recurring_plan_id: 'repl_1', reference_id: SUB_ID, status: 'ACTIVE' },
  });
  const cycle1 = reqWith({
    event: 'recurring.cycle.succeeded',
    data: { id: 'cycle_1', recurring_plan_id: 'repl_1', amount: 999, currency: 'PHP' },
  });
  const paymentSucceeded = reqWith({
    event: 'payment.succeeded',
    data: { id: 'pay_evt_1', recurring_plan_id: 'repl_1', amount: 999, currency: 'PHP' },
  });

  it('activation + first cycle + payment.succeeded (same charge) → ONE Payment, ONE period', async () => {
    const { prisma, controller } = buildStack();

    await controller.handleWebhook('xendit', activated);
    // Activation opens the period but must NOT set the end.
    const afterActivation = prisma.subs.get(SUB_ID)!;
    expect(afterActivation.currentPeriodStart).toBeInstanceOf(Date);
    expect(afterActivation.currentPeriodEnd).toBeNull();
    expect(prisma.payments).toHaveLength(0);

    await controller.handleWebhook('xendit', cycle1);
    await controller.handleWebhook('xendit', paymentSucceeded);

    const sub = prisma.subs.get(SUB_ID)!;
    // Exactly ONE subscription Payment for the charge (payment.succeeded did not add a second).
    expect(prisma.payments).toHaveLength(1);
    expect(prisma.payments[0]!.providerInvoiceId).toBe('cycle_1');
    expect(prisma.payments[0]!.amount).toBe(99900); // 999 PHP → centavos
    // currentPeriodEnd advanced by EXACTLY one month from its start — not two.
    expect(sub.currentPeriodEnd).toBeInstanceOf(Date);
    expect(monthsApart(sub.currentPeriodStart!, sub.currentPeriodEnd!)).toBe(1);
  });

  it('a second, distinct cycle advances exactly one more period and records one more Payment', async () => {
    const { prisma, controller } = buildStack();

    await controller.handleWebhook('xendit', activated);
    await controller.handleWebhook('xendit', cycle1);
    const endAfterFirst = prisma.subs.get(SUB_ID)!.currentPeriodEnd!;

    await controller.handleWebhook(
      'xendit',
      reqWith({
        event: 'recurring.cycle.succeeded',
        data: { id: 'cycle_2', recurring_plan_id: 'repl_1', amount: 999, currency: 'PHP' },
      }),
    );

    const sub = prisma.subs.get(SUB_ID)!;
    expect(prisma.payments).toHaveLength(2);
    expect(prisma.payments[1]!.providerInvoiceId).toBe('cycle_2');
    // The second cycle anchors on the prior end, so it advances exactly one more
    // month with no drift.
    const expected = new Date(endAfterFirst);
    expected.setMonth(expected.getMonth() + 1);
    expect(sub.currentPeriodEnd!.getTime()).toBe(expected.getTime());
  });

  it('replaying each event (via controller idempotency) never advances again or duplicates a Payment', async () => {
    const { prisma, controller } = buildStack();

    await controller.handleWebhook('xendit', activated);
    await controller.handleWebhook('xendit', cycle1);
    await controller.handleWebhook('xendit', paymentSucceeded);

    const endBefore = prisma.subs.get(SUB_ID)!.currentPeriodEnd!.getTime();

    // Replay all three verbatim.
    await controller.handleWebhook('xendit', activated);
    await controller.handleWebhook('xendit', cycle1);
    await controller.handleWebhook('xendit', paymentSucceeded);

    const sub = prisma.subs.get(SUB_ID)!;
    expect(prisma.payments).toHaveLength(1);
    expect(sub.currentPeriodEnd!.getTime()).toBe(endBefore);
  });

  it('cycle.succeeded replay is idempotent even if the controller key is evicted (service-level guard)', async () => {
    const { prisma, redis, controller } = buildStack();

    await controller.handleWebhook('xendit', activated);
    await controller.handleWebhook('xendit', cycle1);
    const endBefore = prisma.subs.get(SUB_ID)!.currentPeriodEnd!.getTime();

    // Simulate the 7-day idempotency key expiring, then a Xendit re-delivery.
    redis.store.delete('billing:webhook:recurring.cycle.succeeded:cycle_1');
    await controller.handleWebhook('xendit', cycle1);

    const sub = prisma.subs.get(SUB_ID)!;
    // The Payment row keyed on cycle id is the second-layer guard: still one
    // Payment, period unchanged.
    expect(prisma.payments).toHaveLength(1);
    expect(sub.currentPeriodEnd!.getTime()).toBe(endBefore);
  });

  it('payment.succeeded on its own never advances the period or records a Payment', async () => {
    const { prisma, controller } = buildStack();

    await controller.handleWebhook('xendit', activated);
    const endAfterActivation = prisma.subs.get(SUB_ID)!.currentPeriodEnd; // null

    await controller.handleWebhook('xendit', paymentSucceeded);

    const sub = prisma.subs.get(SUB_ID)!;
    expect(prisma.payments).toHaveLength(0);
    expect(sub.currentPeriodEnd).toBe(endAfterActivation); // still null — no advance
  });

  // ---- month-end rollover ----

  it('advances ONE month from a 31st, landing on the 30th rather than the 1st', async () => {
    const { prisma, controller } = buildStack();

    await controller.handleWebhook('xendit', activated);
    await controller.handleWebhook('xendit', cycle1);

    const sub = prisma.subs.get(SUB_ID)!;
    const end = sub.currentPeriodEnd!;

    // Pre-fix this was 2026-10-01: Sep has no 31st, so setMonth rolled past it
    // and the subscriber got a free month.
    expect(end.getMonth()).toBe(8); // September
    expect(end.getDate()).toBe(30);
    expect(monthsApart(sub.currentPeriodStart!, end)).toBe(1);
  });

  it('advances ONE month at the exact UTC instant CI failed on', async () => {
    // 2026-08-31T00:19:00Z — the timestamp of the original red build. Kept as a
    // named regression case. On a UTC runner this is the 31st and exercises the
    // clamp; elsewhere it is the 30th and merely asserts the invariant still
    // holds. Either way it must never advance two months.
    pinClockTo(new Date('2026-08-31T00:19:00Z'));

    const { prisma, controller } = buildStack();
    await controller.handleWebhook('xendit', activated);
    await controller.handleWebhook('xendit', cycle1);

    const sub = prisma.subs.get(SUB_ID)!;
    expect(prisma.payments).toHaveLength(1);
    expect(monthsApart(sub.currentPeriodStart!, sub.currentPeriodEnd!)).toBe(1);
  });

  it('advances ONE year on an annual plan from a leap day', async () => {
    // The annual branch carried the identical defect and had no coverage at
    // all: Feb 29 + 1 year rolled to Mar 1.
    pinClockTo(new Date(2028, 1, 29, 12, 0, 0)); // local Feb 29 2028

    const { prisma, controller } = buildStack({ billingPeriod: 'annual' });
    await controller.handleWebhook('xendit', activated);
    await controller.handleWebhook('xendit', cycle1);

    const sub = prisma.subs.get(SUB_ID)!;
    const end = sub.currentPeriodEnd!;

    expect(end.getFullYear()).toBe(2029);
    expect(end.getMonth()).toBe(1); // February, not March
    expect(end.getDate()).toBe(28);
    expect(monthsApart(sub.currentPeriodStart!, end)).toBe(12);
  });
});
