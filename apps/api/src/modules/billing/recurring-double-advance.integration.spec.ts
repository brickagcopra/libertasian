import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { BillingService } from './billing.service';
import { WebhookController } from './webhook.controller';
import { XenditService } from './xendit.service';

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
  xenditSubscriptionId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

interface PaymentRow {
  id: string;
  organizationId: string;
  subscriptionId: string;
  xenditInvoiceId: string;
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
    findUnique: async ({ where }: { where: { xenditInvoiceId: string } }) =>
      this.payments.find((p) => p.xenditInvoiceId === where.xenditInvoiceId) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `pay-${++this.paySeq}`, ...data } as PaymentRow;
      this.payments.push(row);
      return row;
    },
    update: async () => ({}),
  };

  subscription = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      const wanted = where['xenditSubscriptionId'];
      if (wanted === undefined) return null;
      for (const s of this.subs.values()) {
        if (s.xenditSubscriptionId === wanted) return s;
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

  paymentMethod = { upsert: async () => ({}) };

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

const noopAudit = { log: jest.fn().mockResolvedValue(undefined) };
const noopLifecycle = { executeTransition: jest.fn().mockResolvedValue({ success: true }) };
const noopEntitlement = { invalidateEntitlementCache: jest.fn().mockResolvedValue(undefined) };
const noopUsageQuota = { resetQuotasForBillingCycle: jest.fn().mockResolvedValue(undefined) };

/** Build a fake RawBodyRequest carrying the given JSON body. */
function reqWith(body: unknown): RawBodyRequest<Request> {
  return { rawBody: Buffer.from(JSON.stringify(body)) } as RawBodyRequest<Request>;
}

const xenditStub = {
  verifyWebhookToken: jest.fn().mockReturnValue(true),
  parseWebhookEvent: jest.fn((raw: string) => JSON.parse(raw)),
} as unknown as XenditService;

function buildStack() {
  const prisma = new FakePrisma();
  const redis = new FakeRedis();

  // Seed a provisioning subscription linked back via reference_id (its own id),
  // exactly as createCheckout leaves it before plan.activated arrives.
  prisma.subs.set('sub-1', {
    id: 'sub-1',
    organizationId: 'org-1',
    planCode: 'pro',
    billingPeriod: 'monthly',
    status: 'provisioning',
    xenditSubscriptionId: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
  });

  const billing = new BillingService(
    prisma as never, // prisma
    xenditStub, // xenditService
    {} as never, // subscriptionsService (unused on this path)
    noopAudit as never, // auditService
    {} as never, // pricingEngine
    {} as never, // couponService
    {} as never, // promotionService
    noopLifecycle as never, // lifecycleService
    {} as never, // notificationsService
    noopEntitlement as never, // entitlementService
    noopUsageQuota as never, // usageQuotaService
  );

  const controller = new WebhookController(
    xenditStub,
    billing,
    noopAudit as never,
    redis as never,
  );

  return { prisma, redis, controller };
}

const monthsApart = (a: Date, b: Date): number =>
  (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());

describe('recurring billing — double period-advance regression (controller ⇄ service)', () => {
  const activated = reqWith({
    event: 'recurring.plan.activated',
    data: { id: 'repl_1', recurring_plan_id: 'repl_1', reference_id: 'sub-1', status: 'ACTIVE' },
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

    await controller.handleXenditWebhook(activated, 'tok');
    // Activation opens the period but must NOT set the end.
    const afterActivation = prisma.subs.get('sub-1')!;
    expect(afterActivation.currentPeriodStart).toBeInstanceOf(Date);
    expect(afterActivation.currentPeriodEnd).toBeNull();
    expect(prisma.payments).toHaveLength(0);

    await controller.handleXenditWebhook(cycle1, 'tok');
    await controller.handleXenditWebhook(paymentSucceeded, 'tok');

    const sub = prisma.subs.get('sub-1')!;
    // Exactly ONE subscription Payment for the charge (payment.succeeded did not add a second).
    expect(prisma.payments).toHaveLength(1);
    expect(prisma.payments[0]!.xenditInvoiceId).toBe('cycle_1');
    expect(prisma.payments[0]!.amount).toBe(99900); // 999 PHP → centavos
    // currentPeriodEnd advanced by EXACTLY one month from its start — not two.
    expect(sub.currentPeriodEnd).toBeInstanceOf(Date);
    expect(monthsApart(sub.currentPeriodStart!, sub.currentPeriodEnd!)).toBe(1);
  });

  it('a second, distinct cycle advances exactly one more period and records one more Payment', async () => {
    const { prisma, controller } = buildStack();

    await controller.handleXenditWebhook(activated, 'tok');
    await controller.handleXenditWebhook(cycle1, 'tok');
    const endAfterFirst = prisma.subs.get('sub-1')!.currentPeriodEnd!;

    await controller.handleXenditWebhook(
      reqWith({
        event: 'recurring.cycle.succeeded',
        data: { id: 'cycle_2', recurring_plan_id: 'repl_1', amount: 999, currency: 'PHP' },
      }),
      'tok',
    );

    const sub = prisma.subs.get('sub-1')!;
    expect(prisma.payments).toHaveLength(2);
    expect(prisma.payments[1]!.xenditInvoiceId).toBe('cycle_2');
    // The second cycle anchors on the prior end, so it advances exactly one more
    // month with no drift.
    const expected = new Date(endAfterFirst);
    expected.setMonth(expected.getMonth() + 1);
    expect(sub.currentPeriodEnd!.getTime()).toBe(expected.getTime());
  });

  it('replaying each event (via controller idempotency) never advances again or duplicates a Payment', async () => {
    const { prisma, controller } = buildStack();

    await controller.handleXenditWebhook(activated, 'tok');
    await controller.handleXenditWebhook(cycle1, 'tok');
    await controller.handleXenditWebhook(paymentSucceeded, 'tok');

    const endBefore = prisma.subs.get('sub-1')!.currentPeriodEnd!.getTime();

    // Replay all three verbatim.
    await controller.handleXenditWebhook(activated, 'tok');
    await controller.handleXenditWebhook(cycle1, 'tok');
    await controller.handleXenditWebhook(paymentSucceeded, 'tok');

    const sub = prisma.subs.get('sub-1')!;
    expect(prisma.payments).toHaveLength(1);
    expect(sub.currentPeriodEnd!.getTime()).toBe(endBefore);
  });

  it('cycle.succeeded replay is idempotent even if the controller key is evicted (service-level guard)', async () => {
    const { prisma, redis, controller } = buildStack();

    await controller.handleXenditWebhook(activated, 'tok');
    await controller.handleXenditWebhook(cycle1, 'tok');
    const endBefore = prisma.subs.get('sub-1')!.currentPeriodEnd!.getTime();

    // Simulate the 7-day idempotency key expiring, then a Xendit re-delivery.
    redis.store.delete('billing:webhook:recurring.cycle.succeeded:cycle_1');
    await controller.handleXenditWebhook(cycle1, 'tok');

    const sub = prisma.subs.get('sub-1')!;
    // The Payment row keyed on cycle id is the second-layer guard: still one
    // Payment, period unchanged.
    expect(prisma.payments).toHaveLength(1);
    expect(sub.currentPeriodEnd!.getTime()).toBe(endBefore);
  });

  it('payment.succeeded on its own never advances the period or records a Payment', async () => {
    const { prisma, controller } = buildStack();

    await controller.handleXenditWebhook(activated, 'tok');
    const endAfterActivation = prisma.subs.get('sub-1')!.currentPeriodEnd; // null

    await controller.handleXenditWebhook(paymentSucceeded, 'tok');

    const sub = prisma.subs.get('sub-1')!;
    expect(prisma.payments).toHaveLength(0);
    expect(sub.currentPeriodEnd).toBe(endAfterActivation); // still null — no advance
  });
});
