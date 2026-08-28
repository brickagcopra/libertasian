import { createHmac } from 'crypto';

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { PaymongoApiError, PaymongoService } from './paymongo.service';

describe('PaymongoService', () => {
  let service: PaymongoService;

  const mockSecretKey = 'sk_test_paymongo_key';
  const mockWebhookSecret = 'whsk_test_secret_abc123';
  const mockAppUrl = 'https://app.test';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymongoService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string | number) => {
              if (key === 'PAYMONGO_SECRET_KEY') return mockSecretKey;
              if (key === 'PAYMONGO_WEBHOOK_SECRET') return mockWebhookSecret;
              if (key === 'APP_URL') return mockAppUrl;
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<PaymongoService>(PaymongoService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  /** PayMongo single-resource envelope. */
  const envelope = (id: string, attributes: Record<string, unknown> = {}) => ({
    data: { id, type: 'x', attributes },
  });

  const okOnce = (body: unknown) => ({ ok: true, json: jest.fn().mockResolvedValue(body) });

  // ---- Unit conversion ----

  describe('centavo conversion', () => {
    it('converts whole pesos to centavos on the way out', () => {
      expect(PaymongoService.toCentavos(999)).toBe(99900);
      expect(PaymongoService.toCentavos(0)).toBe(0);
      expect(PaymongoService.toCentavos(1)).toBe(100);
      // Half-centavo inputs are rounded, never truncated.
      expect(PaymongoService.toCentavos(10.005)).toBe(1001);
    });

    it('converts centavos to whole pesos on the way in', () => {
      expect(PaymongoService.toMajorUnits(99900)).toBe(999);
      expect(PaymongoService.toMajorUnits(0)).toBe(0);
      expect(PaymongoService.toMajorUnits(100)).toBe(1);
    });

    it('round-trips a whole-peso amount unchanged', () => {
      for (const pesos of [1, 99, 999, 12345]) {
        expect(PaymongoService.toMajorUnits(PaymongoService.toCentavos(pesos))).toBe(pesos);
      }
    });
  });

  // ---- createCustomer ----

  describe('createCustomer', () => {
    it('posts the PayMongo attributes envelope and echoes our reference back', async () => {
      global.fetch = jest.fn().mockResolvedValue(okOnce(envelope('cus_1')));

      const result = await service.createCustomer({
        referenceId: 'org-1',
        email: 'a@b.test',
        mobileNumber: '+639171234567',
        givenNames: 'Juan Dela Cruz',
      });

      // PayMongo stores no reference — the port's referenceId is echoed locally.
      expect(result).toEqual({ id: 'cus_1', referenceId: 'org-1' });

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.paymongo.com/v1/customers');
      expect(init.headers).toEqual(
        expect.objectContaining({ Authorization: expect.stringContaining('Basic ') }),
      );
      expect(JSON.parse(init.body as string)).toEqual({
        data: {
          attributes: {
            first_name: 'Juan Dela',
            last_name: 'Cruz',
            default_device: 'email',
            email: 'a@b.test',
            phone: '+639171234567',
          },
        },
      });
    });

    it('authenticates with base64(secretKey + ":")', async () => {
      global.fetch = jest.fn().mockResolvedValue(okOnce(envelope('cus_1')));

      await service.createCustomer({ referenceId: 'org-1' });

      const [, init] = (global.fetch as jest.Mock).mock.calls[0];
      const expected = Buffer.from(`${mockSecretKey}:`).toString('base64');
      expect(init.headers.Authorization).toBe(`Basic ${expected}`);
    });

    it('falls back to a placeholder name when the port supplies none', async () => {
      global.fetch = jest.fn().mockResolvedValue(okOnce(envelope('cus_1')));

      await service.createCustomer({ referenceId: 'org-1' });

      const [, init] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.data.attributes.first_name).toBe('LIBERTASIAN');
      expect(body.data.attributes.last_name).toBe('Customer');
    });

    it('throws PaymongoApiError carrying the status and errors[0].code', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: jest.fn().mockResolvedValue(
          JSON.stringify({ errors: [{ code: 'parameter_invalid', detail: 'bad email' }] }),
        ),
      });

      const promise = service.createCustomer({ referenceId: 'org-1' });
      await expect(promise).rejects.toThrow('PayMongo API error: 400');
      await promise.catch((err: unknown) => {
        expect(err).toBeInstanceOf(PaymongoApiError);
        expect((err as PaymongoApiError).status).toBe(400);
        expect((err as PaymongoApiError).errorCode).toBe('parameter_invalid');
        expect((err as PaymongoApiError).provider).toBe('paymongo');
      });
    });

    it('tolerates a non-JSON error body', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: jest.fn().mockResolvedValue('<html>bad gateway</html>'),
      });

      await expect(service.createCustomer({ referenceId: 'org-1' })).rejects.toThrow(
        'PayMongo API error: 502',
      );
    });
  });

  // ---- getCustomerByReferenceId ----

  describe('getCustomerByReferenceId', () => {
    it('always returns null — idempotency rides the local pointer', async () => {
      global.fetch = jest.fn();

      await expect(service.getCustomerByReferenceId('org-1')).resolves.toBeNull();
      // PayMongo customers carry no reference_id, so there is nothing to query.
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  // ---- createSubscriptionSession ----

  describe('createSubscriptionSession', () => {
    const params = {
      referenceId: 'sub-1',
      customerId: 'cus_1',
      amount: 999,
      currency: 'PHP',
      interval: 'MONTH' as const,
      intervalCount: 1,
      description: 'LIBERTASIAN Pro Plan — Monthly',
      successReturnUrl: 'https://app.com/success',
      cancelReturnUrl: 'https://app.com/cancel',
      metadata: { organizationId: 'org-1' },
    };

    const planKey = 'libertasian:monthly:1:99900';

    it('reuses an existing catalogue plan matched by name', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(okOnce({ data: [{ id: 'plan_existing', attributes: { name: planKey } }] }))
        .mockResolvedValueOnce(okOnce(envelope('sub_1', { status: 'incomplete' })));

      const result = await service.createSubscriptionSession(params);

      const calls = (global.fetch as jest.Mock).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toBe('https://api.paymongo.com/v1/subscriptions/plans?limit=100');
      expect(calls[1][0]).toBe('https://api.paymongo.com/v1/subscriptions');
      expect(JSON.parse(calls[1][1].body as string)).toEqual({
        data: { attributes: { customer_id: 'cus_1', plan_id: 'plan_existing' } },
      });
      expect(result.sessionId).toBe('sub_1');
      expect(result.status).toBe('incomplete');
    });

    it('creates the plan in centavos when the catalogue has no match', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(okOnce({ data: [] }))
        .mockResolvedValueOnce(okOnce(envelope('plan_new', { name: planKey })))
        .mockResolvedValueOnce(okOnce(envelope('sub_1', { status: 'incomplete' })));

      await service.createSubscriptionSession(params);

      const calls = (global.fetch as jest.Mock).mock.calls;
      expect(calls).toHaveLength(3);
      expect(calls[1][0]).toBe('https://api.paymongo.com/v1/subscriptions/plans');
      expect(JSON.parse(calls[1][1].body as string)).toEqual({
        data: {
          attributes: {
            name: planKey,
            description: params.description,
            // 999 whole pesos -> 99900 centavos.
            amount: 99900,
            currency: 'PHP',
            interval: 'monthly',
            interval_count: 1,
          },
        },
      });
    });

    it('maps the YEAR interval to PayMongo yearly', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(okOnce({ data: [] }))
        .mockResolvedValueOnce(okOnce(envelope('plan_new')))
        .mockResolvedValueOnce(okOnce(envelope('sub_1')));

      await service.createSubscriptionSession({ ...params, interval: 'YEAR' });

      const calls = (global.fetch as jest.Mock).mock.calls;
      const body = JSON.parse(calls[1][1].body as string);
      expect(body.data.attributes.interval).toBe('yearly');
      expect(body.data.attributes.name).toBe('libertasian:yearly:1:99900');
    });

    it('memoizes the resolved plan so the catalogue is listed only once', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(okOnce({ data: [{ id: 'plan_existing', attributes: { name: planKey } }] }))
        .mockResolvedValueOnce(okOnce(envelope('sub_1')))
        .mockResolvedValueOnce(okOnce(envelope('sub_2')));

      await service.createSubscriptionSession(params);
      await service.createSubscriptionSession({ ...params, referenceId: 'sub-2' });

      const calls = (global.fetch as jest.Mock).mock.calls;
      // list + subscribe + subscribe — no second list.
      expect(calls).toHaveLength(3);
      expect(calls[2][0]).toBe('https://api.paymongo.com/v1/subscriptions');
    });

    it('returns our own authorize page — PayMongo has no hosted subscription checkout', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(okOnce({ data: [{ id: 'plan_existing', attributes: { name: planKey } }] }))
        .mockResolvedValueOnce(okOnce(envelope('sub_1', { status: 'incomplete' })));

      const result = await service.createSubscriptionSession(params);

      const url = new URL(result.checkoutUrl as string);
      expect(url.origin + url.pathname).toBe('https://app.test/billing/authorize');
      // `ref` is the LOCAL subscription id, not the gateway id.
      expect(url.searchParams.get('ref')).toBe('sub-1');
      expect(url.searchParams.get('success')).toBe('https://app.com/success');
      expect(url.searchParams.get('cancel')).toBe('https://app.com/cancel');
    });

    it('surfaces the gateway subscription id immediately (unlike Xendit)', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(okOnce({ data: [{ id: 'plan_existing', attributes: { name: planKey } }] }))
        .mockResolvedValueOnce(okOnce(envelope('sub_1', { status: 'incomplete' })));

      const result = await service.createSubscriptionSession(params);

      expect(result.providerSubscriptionId).toBe('sub_1');
      expect(result.referenceId).toBe('sub-1');
    });

    it.each([0, 11])('rejects an out-of-range interval_count (%i)', async (intervalCount) => {
      global.fetch = jest.fn();

      await expect(
        service.createSubscriptionSession({ ...params, intervalCount }),
      ).rejects.toThrow('PayMongo interval_count must be 1-10');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  // ---- retrieveSubscription / cancelSubscription / attachPaymentMethod ----

  describe('retrieveSubscription', () => {
    it('maps the subscription envelope into the neutral DTO, in whole pesos', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        okOnce(
          envelope('sub_1', {
            customer_id: 'cus_1',
            status: 'active',
            currency: 'PHP',
            amount: 99900,
          }),
        ),
      );

      const result = await service.retrieveSubscription('sub_1');

      expect(result).toEqual({
        id: 'sub_1',
        customerId: 'cus_1',
        status: 'active',
        currency: 'PHP',
        amount: 999,
      });
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
        'https://api.paymongo.com/v1/subscriptions/sub_1',
      );
    });
  });

  describe('cancelSubscription', () => {
    it('posts the required cancellation_reason', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(okOnce(envelope('sub_1', { status: 'cancelled' })));

      const result = await service.cancelSubscription('sub_1');

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.paymongo.com/v1/subscriptions/sub_1/cancel');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({
        data: { attributes: { cancellation_reason: 'other' } },
      });
      expect(result.status).toBe('cancelled');
    });
  });

  describe('attachSubscriptionPaymentMethod', () => {
    it('PUTs the instrument and redirect url', async () => {
      global.fetch = jest.fn().mockResolvedValue(okOnce(envelope('sub_1', { status: 'active' })));

      await service.attachSubscriptionPaymentMethod(
        'sub_1',
        'pm_1',
        'https://app.test/billing/return',
      );

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.paymongo.com/v1/subscriptions/sub_1/payment_method');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body as string)).toEqual({
        data: {
          attributes: {
            payment_method_id: 'pm_1',
            redirect_url: 'https://app.test/billing/return',
          },
        },
      });
    });

    it('surfaces setup_intent.next_action_url when the card needs a further step', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        okOnce(
          envelope('sub_1', {
            status: 'incomplete',
            setup_intent: { next_action_url: 'https://paymongo.test/3ds/abc' },
          }),
        ),
      );

      const result = await service.attachSubscriptionPaymentMethod(
        'sub_1',
        'pm_1',
        'https://app.test/billing/return',
      );

      expect(result).toEqual({
        status: 'incomplete',
        nextActionUrl: 'https://paymongo.test/3ds/abc',
      });
    });

    it('reports a null next action when the gateway issues none', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(okOnce(envelope('sub_1', { status: 'active' })));

      const result = await service.attachSubscriptionPaymentMethod(
        'sub_1',
        'pm_1',
        'https://app.test/billing/return',
      );

      expect(result).toEqual({ status: 'active', nextActionUrl: null });
    });

    it('treats an explicitly null next_action_url as no next action', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        okOnce(envelope('sub_1', { status: 'active', setup_intent: { next_action_url: null } })),
      );

      const result = await service.attachSubscriptionPaymentMethod(
        'sub_1',
        'pm_1',
        'https://app.test/billing/return',
      );

      expect(result.nextActionUrl).toBeNull();
    });
  });

  // ---- createInvoice / retrieveInvoice (Checkout Sessions) ----

  describe('createInvoice', () => {
    const params = {
      amount: 999,
      currency: 'PHP',
      description: 'LIBERTASIAN Pro Plan — Monthly',
      externalId: 'ext-uuid-123',
      metadata: { organizationId: 'org-1' },
      successRedirectUrl: 'https://app.com/success',
      failureRedirectUrl: 'https://app.com/cancel',
    };

    it('creates a v2 checkout session with the amount in centavos', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        okOnce(
          envelope('cs_1', {
            checkout_url: 'https://checkout.paymongo.com/cs_1',
            reference_number: 'ext-uuid-123',
            status: 'unpaid',
            line_items: [{ name: params.description, amount: 99900, currency: 'PHP', quantity: 1 }],
          }),
        ),
      );

      const result = await service.createInvoice(params);

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.paymongo.com/v2/checkout_sessions');
      expect(JSON.parse(init.body as string)).toEqual({
        data: {
          attributes: {
            line_items: [
              { name: params.description, amount: 99900, currency: 'PHP', quantity: 1 },
            ],
            payment_method_types: ['card', 'gcash', 'paymaya', 'grab_pay'],
            reference_number: 'ext-uuid-123',
            success_url: 'https://app.com/success',
            cancel_url: 'https://app.com/cancel',
            metadata: { organizationId: 'org-1' },
          },
        },
      });

      // Neutral DTO: back in whole pesos, with the hosted URL surfaced.
      expect(result).toEqual({
        id: 'cs_1',
        externalId: 'ext-uuid-123',
        invoiceUrl: 'https://checkout.paymongo.com/cs_1',
        status: 'unpaid',
        amount: 999,
        currency: 'PHP',
        description: params.description,
      });
    });
  });

  describe('retrieveInvoice', () => {
    it('retrieves a checkout session by id', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        okOnce(
          envelope('cs_2', {
            checkout_url: 'https://checkout.paymongo.com/cs_2',
            reference_number: 'ext-uuid-456',
            status: 'paid',
            line_items: [{ name: 'Pro', amount: 149900, currency: 'PHP', quantity: 1 }],
          }),
        ),
      );

      const result = await service.retrieveInvoice('cs_2');

      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
        'https://api.paymongo.com/v2/checkout_sessions/cs_2',
      );
      expect(result.id).toBe('cs_2');
      expect(result.amount).toBe(1499);
      expect(result.status).toBe('paid');
    });
  });

  // ---- verifyWebhookSignature ----

  describe('verifyWebhookSignature', () => {
    const rawBody = JSON.stringify({ data: { id: 'evt_1' } });

    const sign = (timestamp: number, body = rawBody, secret = mockWebhookSecret) =>
      createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

    const nowSec = () => Math.floor(Date.now() / 1000);

    it('accepts a valid live signature', () => {
      const t = nowSec();
      const header = `t=${t},te=deadbeef,li=${sign(t)}`;

      expect(service.verifyWebhookSignature(rawBody, { 'paymongo-signature': header })).toBe(
        'valid',
      );
    });

    it('falls back to the test signature when no live signature is present', () => {
      const t = nowSec();
      const header = `t=${t},te=${sign(t)}`;

      expect(service.verifyWebhookSignature(rawBody, { 'paymongo-signature': header })).toBe(
        'valid',
      );
    });

    it('prefers the live signature over the test one', () => {
      const t = nowSec();
      // te is garbage; li is correct — preferring li must still verify.
      const header = `t=${t},te=deadbeef,li=${sign(t)}`;
      expect(service.verifyWebhookSignature(rawBody, { 'paymongo-signature': header })).toBe(
        'valid',
      );

      // li is garbage; te is correct — li wins, so this must NOT verify.
      const flipped = `t=${t},te=${sign(t)},li=${'0'.repeat(64)}`;
      expect(service.verifyWebhookSignature(rawBody, { 'paymongo-signature': flipped })).toBe(
        'invalid',
      );
    });

    // REGRESSION: PayMongo populates ONLY the field matching the mode of the
    // event and sends the other one PRESENT BUT EMPTY. `??` does not fall
    // through on an empty string, so an empty `li=` used to bind as the
    // signature and every test-mode webhook was rejected — a failure that would
    // look like "PayMongo is not sending webhooks" in test mode and then
    // silently start working on the live key swap. Empties are now dropped at
    // the parse step. The two tests below use the real header shapes; the
    // fallback test above omits `li=` entirely, which is why this got through.
    it('accepts the real test-mode header shape, with li present but empty', () => {
      const t = nowSec();
      const header = `t=${t},te=${sign(t)},li=`;

      expect(service.verifyWebhookSignature(rawBody, { 'paymongo-signature': header })).toBe(
        'valid',
      );
    });

    it('accepts the real live-mode header shape, with te present but empty', () => {
      const t = nowSec();
      const header = `t=${t},te=,li=${sign(t)}`;

      expect(service.verifyWebhookSignature(rawBody, { 'paymongo-signature': header })).toBe(
        'valid',
      );
    });

    it('rejects a signature computed with the wrong secret', () => {
      const t = nowSec();
      const header = `t=${t},li=${sign(t, rawBody, 'whsk_wrong_secret')}`;

      expect(service.verifyWebhookSignature(rawBody, { 'paymongo-signature': header })).toBe(
        'invalid',
      );
    });

    it('rejects a signature that does not cover this exact body', () => {
      const t = nowSec();
      const header = `t=${t},li=${sign(t, JSON.stringify({ data: { id: 'evt_other' } }))}`;

      expect(service.verifyWebhookSignature(rawBody, { 'paymongo-signature': header })).toBe(
        'invalid',
      );
    });

    it('reports a missing header distinctly from a wrong one', () => {
      expect(service.verifyWebhookSignature(rawBody, {})).toBe('missing');
      expect(service.verifyWebhookSignature(rawBody, { 'paymongo-signature': '' })).toBe('missing');
    });

    it('rejects a malformed header with no timestamp or digest', () => {
      expect(
        service.verifyWebhookSignature(rawBody, { 'paymongo-signature': 'garbage' }),
      ).toBe('invalid');
      expect(
        service.verifyWebhookSignature(rawBody, { 'paymongo-signature': 'te=abc,li=def' }),
      ).toBe('invalid');
      expect(
        service.verifyWebhookSignature(rawBody, { 'paymongo-signature': `t=${nowSec()}` }),
      ).toBe('invalid');
    });

    it('rejects a non-numeric timestamp', () => {
      const header = `t=not-a-number,li=${sign(nowSec())}`;
      expect(service.verifyWebhookSignature(rawBody, { 'paymongo-signature': header })).toBe(
        'invalid',
      );
    });

    it('rejects a correctly-signed payload whose timestamp is older than the tolerance', () => {
      const stale = nowSec() - 301;
      const header = `t=${stale},li=${sign(stale)}`;

      expect(service.verifyWebhookSignature(rawBody, { 'paymongo-signature': header })).toBe(
        'invalid',
      );
    });

    it('rejects a timestamp too far in the future', () => {
      const future = nowSec() + 301;
      const header = `t=${future},li=${sign(future)}`;

      expect(service.verifyWebhookSignature(rawBody, { 'paymongo-signature': header })).toBe(
        'invalid',
      );
    });

    it('accepts a timestamp just inside the tolerance window', () => {
      const edge = nowSec() - 299;
      const header = `t=${edge},li=${sign(edge)}`;

      expect(service.verifyWebhookSignature(rawBody, { 'paymongo-signature': header })).toBe(
        'valid',
      );
    });
  });

  // ---- parseWebhookEvent ----

  describe('parseWebhookEvent', () => {
    /** `{ data: { id, attributes: { type, data: <resource> } } }`. */
    const webhook = (
      type: string,
      resourceId: string,
      attributes: Record<string, unknown> = {},
    ) =>
      JSON.stringify({
        data: {
          id: 'evt_1',
          attributes: {
            type,
            livemode: true,
            created_at: 1756200000,
            data: { id: resourceId, type: 'x', attributes },
          },
        },
      });

    it.each([
      ['subscription.invoice.paid', 'subscription.cycle.succeeded'],
      ['subscription.invoice.payment_failed', 'subscription.cycle.failed'],
      ['subscription.invoice.created', 'subscription.cycle.created'],
      ['subscription.invoice.finalized', 'unknown'],
    ])('maps %s to %s, keyed on the invoice id', (eventName, internalType) => {
      const result = service.parseWebhookEvent(
        webhook(eventName, 'inv_1', {
          subscription_id: 'sub_1',
          customer_id: 'cus_1',
          status: 'paid',
          amount: 99900,
          currency: 'PHP',
        }),
      );

      expect(result.type).toBe(internalType);
      expect(result.entityId).toBe('inv_1');
      expect(result.provider).toBe('paymongo');
      expect(result.providerEventName).toBe(eventName);
      expect(result.idempotencyScope).toBe(eventName);
      expect(result.auditSuffix).toBe(eventName.replace(/\./g, '_'));
      expect(result.data).toEqual(
        expect.objectContaining({
          id: 'inv_1',
          // The PayMongo SUBSCRIPTION id is what Subscription.providerSubscriptionId holds.
          planId: 'sub_1',
          // Centavos divided by 100 before entering the port.
          amount: 999,
        }),
      );
    });

    it.each([
      ['active', 'subscription.activated'],
      ['cancelled', 'subscription.deactivated'],
      ['incomplete_cancelled', 'subscription.deactivated'],
      ['incomplete', 'unknown'],
      ['past_due', 'unknown'],
    ])('branches subscription.updated status %s to %s', (status, internalType) => {
      const result = service.parseWebhookEvent(
        webhook('subscription.updated', 'sub_1', { status, customer_id: 'cus_1' }),
      );

      expect(result.type).toBe(internalType);
      expect(result.entityId).toBe('sub_1');
      expect(result.idempotencyScope).toBe('subscription.updated');
      expect(result.auditSuffix).toBe('subscription_updated');
      // For subscription.* events the resource IS the subscription.
      expect(result.data).toEqual(expect.objectContaining({ id: 'sub_1', planId: 'sub_1' }));
    });

    it('lifts a saved instrument off an activation payload', () => {
      const result = service.parseWebhookEvent(
        webhook('subscription.updated', 'sub_1', {
          status: 'active',
          payment_method_id: 'pm_1',
          payment_method_type: 'gcash',
        }),
      );

      expect(result.type).toBe('subscription.activated');
      expect(result.data).toEqual(
        expect.objectContaining({ paymentMethodId: 'pm_1', paymentMethodType: 'gcash' }),
      );
    });

    it('maps subscription.unpaid to subscription.deactivated', () => {
      const result = service.parseWebhookEvent(webhook('subscription.unpaid', 'sub_1', {}));

      expect(result.type).toBe('subscription.deactivated');
      expect(result.entityId).toBe('sub_1');
      expect(result.auditSuffix).toBe('subscription_unpaid');
    });

    it('maps subscription.past_due to unknown on purpose (dunning is owned by invoice.payment_failed)', () => {
      const result = service.parseWebhookEvent(webhook('subscription.past_due', 'sub_1', {}));

      // Handling this as well as subscription.invoice.payment_failed would
      // double-count a single failed cycle.
      expect(result.type).toBe('unknown');
      expect(result.entityId).toBe('sub_1');
      expect(result.auditSuffix).toBe('subscription_past_due');
    });

    it('maps checkout_session.payment.paid to payment.succeeded, keyed on the session id', () => {
      const result = service.parseWebhookEvent(
        webhook('checkout_session.payment.paid', 'cs_1', { status: 'paid' }),
      );

      expect(result.type).toBe('payment.succeeded');
      // The checkout session id is what Payment.providerInvoiceId holds.
      expect(result.entityId).toBe('cs_1');
      expect(result.data).toEqual(expect.objectContaining({ id: 'cs_1', status: 'paid' }));
      expect(result.auditSuffix).toBe('checkout_session_payment_paid');
    });

    it('maps payment.paid to the LOG-ONLY payment.captured, never the cycle handler', () => {
      const result = service.parseWebhookEvent(
        webhook('payment.paid', 'pay_1', { amount: 99900, currency: 'PHP', status: 'paid' }),
      );

      // payment.paid fires alongside subscription.invoice.paid for the SAME
      // charge but carries a DIFFERENT id. Routing it into the cycle handler
      // would record a second Payment and advance the period twice.
      expect(result.type).toBe('payment.captured');
      expect(result.type).not.toBe('subscription.cycle.succeeded');
      expect(result.entityId).toBe('pay_1');
      expect(result.data).toEqual(expect.objectContaining({ id: 'pay_1', amount: 999 }));
    });

    it('maps payment.failed to payment.failed and carries the failure reason', () => {
      const result = service.parseWebhookEvent(
        webhook('payment.failed', 'pay_2', {
          status: 'failed',
          last_payment_error: 'card_declined',
        }),
      );

      expect(result.type).toBe('payment.failed');
      expect(result.entityId).toBe('pay_2');
      expect(result.data).toEqual(
        expect.objectContaining({ id: 'pay_2', failureReason: 'card_declined' }),
      );
    });

    it('maps payment.refunded to refund.succeeded with camelCase linkage, in whole pesos', () => {
      const result = service.parseWebhookEvent(
        webhook('payment.refunded', 'ref_1', {
          payment_id: 'pay_1',
          checkout_session_id: 'cs_1',
          amount: 99900,
          currency: 'PHP',
          status: 'succeeded',
          reason: 'requested_by_customer',
        }),
      );

      expect(result.type).toBe('refund.succeeded');
      expect(result.entityId).toBe('ref_1');
      expect(result.data).toEqual(
        expect.objectContaining({
          id: 'ref_1',
          invoiceId: 'cs_1',
          paymentRequestId: 'pay_1',
          amount: 999,
        }),
      );
    });

    it.each([
      ['succeeded', 'refund.succeeded'],
      ['failed', 'refund.failed'],
      ['pending', 'refund.failed'],
    ])('branches payment.refund.updated status %s to %s', (status, internalType) => {
      const result = service.parseWebhookEvent(
        webhook('payment.refund.updated', 'ref_2', { status, amount: 50000, payment_id: 'pay_1' }),
      );

      expect(result.type).toBe(internalType);
      expect(result.entityId).toBe('ref_2');
      expect(result.idempotencyScope).toBe('payment.refund.updated');
      expect(result.auditSuffix).toBe('payment_refund_updated');
      expect(result.data).toEqual(expect.objectContaining({ id: 'ref_2', amount: 500 }));
    });

    it('defaults a refund amount to 0 when the payload carries none', () => {
      const result = service.parseWebhookEvent(webhook('payment.refunded', 'ref_3', {}));

      expect(result.data).toEqual(expect.objectContaining({ amount: 0 }));
    });

    it('falls back to unknown for an unrecognised event name', () => {
      const result = service.parseWebhookEvent(webhook('source.chargeable', 'src_1', { x: 1 }));

      expect(result.type).toBe('unknown');
      expect(result.providerEventName).toBe('source.chargeable');
      expect(result.auditSuffix).toBe('source_chargeable');
      expect(result.entityId).toBe('src_1');
    });

    it('does not throw on an envelope with no event type or resource', () => {
      const result = service.parseWebhookEvent(JSON.stringify({ data: {} }));

      expect(result.type).toBe('unknown');
      expect(result.entityId).toBeUndefined();
      expect(result.providerEventName).toBe('');
    });
  });
});
