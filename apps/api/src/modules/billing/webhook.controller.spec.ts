import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { RedisService } from '../../common/services/redis.service';
import { AuditService } from '../audit/audit.service';
import { BillingService } from './billing.service';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { WebhookController } from './webhook.controller';
import { XenditService } from './xendit.service';

const CALLBACK_TOKEN = 'tok';

/**
 * Build a fake RawBodyRequest carrying the given JSON body and callback token.
 * The token now travels on the request headers (the controller no longer knows
 * which header a given gateway uses — the adapter reads it).
 */
function reqWith(body: unknown, token: string = CALLBACK_TOKEN): RawBodyRequest<Request> {
  return {
    rawBody: Buffer.from(JSON.stringify(body)),
    headers: { 'x-callback-token': token },
  } as unknown as RawBodyRequest<Request>;
}

describe('WebhookController', () => {
  let controller: WebhookController;
  let billingService: jest.Mocked<BillingService>;
  let auditService: jest.Mocked<AuditService>;

  /** In-memory Redis stand-in so idempotency keys behave realistically. */
  let store: Map<string, string>;

  beforeEach(async () => {
    store = new Map();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        // A REAL XenditService is bound to the port here (not a stub) so these
        // tests keep exercising the actual payload-shape → internal-event
        // translation, and therefore the real Redis keys and audit actions.
        XenditService,
        { provide: PAYMENT_PROVIDER, useExisting: XenditService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) =>
              key === 'XENDIT_WEBHOOK_CALLBACK_TOKEN' ? CALLBACK_TOKEN : (fallback ?? ''),
            ),
          },
        },
        {
          provide: BillingService,
          useValue: {
            handlePaymentSuccess: jest.fn().mockResolvedValue(undefined),
            handlePaymentFailed: jest.fn().mockResolvedValue(undefined),
            handleRefundSucceeded: jest.fn().mockResolvedValue(undefined),
            handleSubscriptionActivated: jest.fn().mockResolvedValue(undefined),
            handleCycleSucceeded: jest.fn().mockResolvedValue(undefined),
            handleCycleFailed: jest.fn().mockResolvedValue(undefined),
            handlePlanDeactivated: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: AuditService,
          useValue: { log: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(async (k: string) => store.get(k) ?? null),
            set: jest.fn(async (k: string, v: string) => {
              store.set(k, v);
            }),
            del: jest.fn(async (k: string) => {
              store.delete(k);
            }),
          },
        },
      ],
    }).compile();

    controller = module.get(WebhookController);
    billingService = module.get(BillingService);
    auditService = module.get(AuditService);
  });

  it('rejects an invalid callback token', async () => {
    await expect(
      controller.handleWebhook('xendit', reqWith({ id: 'inv_1', status: 'PAID' }, 'bad-token')),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a missing callback token', async () => {
    await expect(
      controller.handleWebhook('xendit', reqWith({ id: 'inv_1', status: 'PAID' }, '')),
    ).rejects.toThrow(BadRequestException);
  });

  // The dashboard-configured URL is /billing/webhooks/xendit; the route is now
  // parameterised, so the alias must keep resolving to the Xendit adapter.
  it('serves the legacy /billing/webhooks/xendit path via the :provider param', async () => {
    await expect(
      controller.handleWebhook('xendit', reqWith({ id: 'inv_alias', status: 'PAID' })),
    ).resolves.toEqual({ received: true });
    expect(billingService.handlePaymentSuccess).toHaveBeenCalledTimes(1);
  });

  it('404s an unknown provider slug rather than verifying with the wrong adapter', async () => {
    await expect(
      controller.handleWebhook('paymongo', reqWith({ id: 'inv_1', status: 'PAID' })),
    ).rejects.toThrow(NotFoundException);
  });

  it('routes a flat PAID invoice event to handlePaymentSuccess', async () => {
    await controller.handleWebhook('xendit', reqWith({ id: 'inv_1', status: 'PAID' }));

    expect(billingService.handlePaymentSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inv_1', status: 'PAID' }),
    );
    expect(billingService.handleRefundSucceeded).not.toHaveBeenCalled();
    expect(billingService.handleCycleSucceeded).not.toHaveBeenCalled();
  });

  it('routes an EXPIRED invoice event to handlePaymentFailed', async () => {
    await controller.handleWebhook('xendit', reqWith({ id: 'inv_x', status: 'EXPIRED' }));

    expect(billingService.handlePaymentFailed).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inv_x' }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.webhook.xendit.expired' }),
    );
  });

  it('routes a refund.succeeded envelope to handleRefundSucceeded', async () => {
    const data = {
      id: 'refund_1',
      invoice_id: 'inv_1',
      amount: 999,
      currency: 'PHP',
      status: 'SUCCEEDED',
    };

    await controller.handleWebhook('xendit', reqWith({ event: 'refund.succeeded', data }));

    // The handler now receives the neutral DTO, not Xendit's snake_case payload.
    expect(billingService.handleRefundSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'refund_1', invoiceId: 'inv_1' }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.webhook.xendit.refund_succeeded' }),
    );
  });

  it('refund.failed only warns + audits, no entitlement change', async () => {
    await controller.handleWebhook(
      'xendit',
      reqWith({
        event: 'refund.failed',
        data: {
          id: 'refund_2',
          invoice_id: 'inv_1',
          amount: 999,
          currency: 'PHP',
          status: 'FAILED',
        },
      }),
    );

    expect(billingService.handleRefundSucceeded).not.toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.webhook.xendit.refund_failed' }),
    );
  });

  it('routes recurring.plan.activated to handleSubscriptionActivated', async () => {
    await controller.handleWebhook(
      'xendit',
      reqWith({ event: 'recurring.plan.activated', data: { id: 'repl_1', reference_id: 'sub-1' } }),
    );

    expect(billingService.handleSubscriptionActivated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'repl_1', referenceId: 'sub-1' }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.webhook.xendit.recurring_plan_activated' }),
    );
  });

  it('routes recurring.cycle.succeeded to handleCycleSucceeded (authoritative)', async () => {
    await controller.handleWebhook(
      'xendit',
      reqWith({
        event: 'recurring.cycle.succeeded',
        data: { id: 'cycle_1', recurring_plan_id: 'repl_1' },
      }),
    );

    expect(billingService.handleCycleSucceeded).toHaveBeenCalledTimes(1);
    expect(billingService.handleCycleSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cycle_1', planId: 'repl_1' }),
    );
  });

  it('does NOT route payment.succeeded into handleCycleSucceeded (log-only, no period advance)', async () => {
    // payment.succeeded fires alongside recurring.cycle.succeeded for the SAME
    // charge but with a different data.id. It must be informational only — never
    // a second period advance / Payment. This is the double-advance guard.
    await controller.handleWebhook(
      'xendit',
      reqWith({
        event: 'payment.succeeded',
        data: { id: 'pay_evt_1', recurring_plan_id: 'repl_1' },
      }),
    );

    expect(billingService.handleCycleSucceeded).not.toHaveBeenCalled();
    expect(billingService.handleSubscriptionActivated).not.toHaveBeenCalled();
    // Still acknowledged + audited so the gateway does not retry it.
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.webhook.xendit.payment_succeeded' }),
    );
  });

  it('routes recurring.cycle.failed to handleCycleFailed', async () => {
    await controller.handleWebhook(
      'xendit',
      reqWith({
        event: 'recurring.cycle.failed',
        data: { id: 'cycle_2', recurring_plan_id: 'repl_1' },
      }),
    );

    expect(billingService.handleCycleFailed).toHaveBeenCalled();
  });

  it('routes recurring.plan.inactivated to handlePlanDeactivated', async () => {
    await controller.handleWebhook(
      'xendit',
      reqWith({ event: 'recurring.plan.inactivated', data: { id: 'repl_1' } }),
    );

    expect(billingService.handlePlanDeactivated).toHaveBeenCalled();
  });

  it('dedups a replayed invoice event on the kind-scoped key', async () => {
    const req = () => reqWith({ id: 'inv_1', status: 'PAID' });

    await controller.handleWebhook('xendit', req());
    await controller.handleWebhook('xendit', req());

    expect(billingService.handlePaymentSuccess).toHaveBeenCalledTimes(1);
  });

  it('dedups a replayed recurring event on the kind-scoped key', async () => {
    const req = () =>
      reqWith({
        event: 'recurring.cycle.succeeded',
        data: { id: 'cycle_dup', recurring_plan_id: 'repl_1' },
      });

    await controller.handleWebhook('xendit', req());
    await controller.handleWebhook('xendit', req());

    expect(billingService.handleCycleSucceeded).toHaveBeenCalledTimes(1);
    expect(store.has('billing:webhook:recurring.cycle.succeeded:cycle_dup')).toBe(true);
  });

  // REGRESSION: the original idempotency bug keyed on the invoice id alone, so a
  // refund webhook collided with the earlier PAID event for the same invoice and
  // was silently dropped. With event-kind-scoped keys both must process.
  it('processes BOTH a PAID and a later refund event for the SAME invoice id', async () => {
    await controller.handleWebhook('xendit', reqWith({ id: 'inv_1', status: 'PAID' }));
    await controller.handleWebhook(
      'xendit',
      reqWith({
        event: 'refund.succeeded',
        data: {
          id: 'refund_1',
          invoice_id: 'inv_1',
          amount: 999,
          currency: 'PHP',
          status: 'SUCCEEDED',
        },
      }),
    );

    expect(billingService.handlePaymentSuccess).toHaveBeenCalledTimes(1);
    expect(billingService.handleRefundSucceeded).toHaveBeenCalledTimes(1);
    // distinct idempotency keys were written
    expect(store.has('billing:webhook:invoice:inv_1')).toBe(true);
    expect(store.has('billing:webhook:refund:refund_1')).toBe(true);
  });

  it('processes a PAID invoice and a recurring event with the SAME id without collision', async () => {
    await controller.handleWebhook('xendit', reqWith({ id: 'shared', status: 'PAID' }));
    await controller.handleWebhook(
      'xendit',
      reqWith({
        event: 'recurring.cycle.succeeded',
        data: { id: 'shared', recurring_plan_id: 'repl_1' },
      }),
    );

    expect(billingService.handlePaymentSuccess).toHaveBeenCalledTimes(1);
    expect(billingService.handleCycleSucceeded).toHaveBeenCalledTimes(1);
    expect(store.has('billing:webhook:invoice:shared')).toBe(true);
    expect(store.has('billing:webhook:recurring.cycle.succeeded:shared')).toBe(true);
  });
});
