import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { RedisService } from '../../common/services/redis.service';
import { AuditService } from '../audit/audit.service';
import { BillingService } from './billing.service';
import { WebhookController } from './webhook.controller';
import { XenditService } from './xendit.service';

/** Build a fake RawBodyRequest carrying the given JSON body. */
function reqWith(body: unknown): RawBodyRequest<Request> {
  return { rawBody: Buffer.from(JSON.stringify(body)) } as RawBodyRequest<Request>;
}

describe('WebhookController', () => {
  let controller: WebhookController;
  let billingService: jest.Mocked<BillingService>;
  let auditService: jest.Mocked<AuditService>;
  let xenditService: jest.Mocked<XenditService>;

  /** In-memory Redis stand-in so idempotency keys behave realistically. */
  let store: Map<string, string>;

  beforeEach(async () => {
    store = new Map();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        {
          provide: XenditService,
          useValue: {
            verifyWebhookToken: jest.fn().mockReturnValue(true),
            // Mirror the real parser: plain JSON.parse of the raw body.
            parseWebhookEvent: jest.fn((raw: string) => JSON.parse(raw)),
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
    xenditService = module.get(XenditService);
  });

  it('rejects an invalid callback token', async () => {
    xenditService.verifyWebhookToken.mockReturnValue(false);

    await expect(
      controller.handleXenditWebhook(reqWith({ id: 'inv_1', status: 'PAID' }), 'bad-token'),
    ).rejects.toThrow(BadRequestException);
  });

  it('routes a flat PAID invoice event to handlePaymentSuccess', async () => {
    await controller.handleXenditWebhook(
      reqWith({ id: 'inv_1', status: 'PAID' }),
      'tok',
    );

    expect(billingService.handlePaymentSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inv_1', status: 'PAID' }),
    );
    expect(billingService.handleRefundSucceeded).not.toHaveBeenCalled();
    expect(billingService.handleCycleSucceeded).not.toHaveBeenCalled();
  });

  it('routes a refund.succeeded envelope to handleRefundSucceeded', async () => {
    const data = { id: 'refund_1', invoice_id: 'inv_1', amount: 999, currency: 'PHP', status: 'SUCCEEDED' };

    await controller.handleXenditWebhook(
      reqWith({ event: 'refund.succeeded', data }),
      'tok',
    );

    expect(billingService.handleRefundSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'refund_1', invoice_id: 'inv_1' }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.webhook.xendit.refund_succeeded' }),
    );
  });

  it('refund.failed only warns + audits, no entitlement change', async () => {
    await controller.handleXenditWebhook(
      reqWith({
        event: 'refund.failed',
        data: { id: 'refund_2', invoice_id: 'inv_1', amount: 999, currency: 'PHP', status: 'FAILED' },
      }),
      'tok',
    );

    expect(billingService.handleRefundSucceeded).not.toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.webhook.xendit.refund_failed' }),
    );
  });

  it('routes recurring.plan.activated to handleSubscriptionActivated', async () => {
    await controller.handleXenditWebhook(
      reqWith({ event: 'recurring.plan.activated', data: { id: 'repl_1', reference_id: 'sub-1' } }),
      'tok',
    );

    expect(billingService.handleSubscriptionActivated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'repl_1' }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.webhook.xendit.recurring_plan_activated' }),
    );
  });

  it('routes recurring.cycle.succeeded AND payment.succeeded to handleCycleSucceeded', async () => {
    await controller.handleXenditWebhook(
      reqWith({ event: 'recurring.cycle.succeeded', data: { id: 'cycle_1', recurring_plan_id: 'repl_1' } }),
      'tok',
    );
    await controller.handleXenditWebhook(
      reqWith({ event: 'payment.succeeded', data: { id: 'pay_evt_1', recurring_plan_id: 'repl_1' } }),
      'tok',
    );

    expect(billingService.handleCycleSucceeded).toHaveBeenCalledTimes(2);
  });

  it('routes recurring.cycle.failed to handleCycleFailed', async () => {
    await controller.handleXenditWebhook(
      reqWith({ event: 'recurring.cycle.failed', data: { id: 'cycle_2', recurring_plan_id: 'repl_1' } }),
      'tok',
    );

    expect(billingService.handleCycleFailed).toHaveBeenCalled();
  });

  it('routes recurring.plan.inactivated to handlePlanDeactivated', async () => {
    await controller.handleXenditWebhook(
      reqWith({ event: 'recurring.plan.inactivated', data: { id: 'repl_1' } }),
      'tok',
    );

    expect(billingService.handlePlanDeactivated).toHaveBeenCalled();
  });

  it('dedups a replayed invoice event on the kind-scoped key', async () => {
    const req = () => reqWith({ id: 'inv_1', status: 'PAID' });

    await controller.handleXenditWebhook(req(), 'tok');
    await controller.handleXenditWebhook(req(), 'tok');

    expect(billingService.handlePaymentSuccess).toHaveBeenCalledTimes(1);
  });

  it('dedups a replayed recurring event on the kind-scoped key', async () => {
    const req = () =>
      reqWith({ event: 'recurring.cycle.succeeded', data: { id: 'cycle_dup', recurring_plan_id: 'repl_1' } });

    await controller.handleXenditWebhook(req(), 'tok');
    await controller.handleXenditWebhook(req(), 'tok');

    expect(billingService.handleCycleSucceeded).toHaveBeenCalledTimes(1);
    expect(store.has('billing:webhook:recurring.cycle.succeeded:cycle_dup')).toBe(true);
  });

  // REGRESSION: the original idempotency bug keyed on the invoice id alone, so a
  // refund webhook collided with the earlier PAID event for the same invoice and
  // was silently dropped. With event-kind-scoped keys both must process.
  it('processes BOTH a PAID and a later refund event for the SAME invoice id', async () => {
    await controller.handleXenditWebhook(
      reqWith({ id: 'inv_1', status: 'PAID' }),
      'tok',
    );
    await controller.handleXenditWebhook(
      reqWith({
        event: 'refund.succeeded',
        data: { id: 'refund_1', invoice_id: 'inv_1', amount: 999, currency: 'PHP', status: 'SUCCEEDED' },
      }),
      'tok',
    );

    expect(billingService.handlePaymentSuccess).toHaveBeenCalledTimes(1);
    expect(billingService.handleRefundSucceeded).toHaveBeenCalledTimes(1);
    // distinct idempotency keys were written
    expect(store.has('billing:webhook:invoice:inv_1')).toBe(true);
    expect(store.has('billing:webhook:refund:refund_1')).toBe(true);
  });

  it('processes a PAID invoice and a recurring event with the SAME id without collision', async () => {
    await controller.handleXenditWebhook(reqWith({ id: 'shared', status: 'PAID' }), 'tok');
    await controller.handleXenditWebhook(
      reqWith({ event: 'recurring.cycle.succeeded', data: { id: 'shared', recurring_plan_id: 'repl_1' } }),
      'tok',
    );

    expect(billingService.handlePaymentSuccess).toHaveBeenCalledTimes(1);
    expect(billingService.handleCycleSucceeded).toHaveBeenCalledTimes(1);
    expect(store.has('billing:webhook:invoice:shared')).toBe(true);
    expect(store.has('billing:webhook:recurring.cycle.succeeded:shared')).toBe(true);
  });
});
