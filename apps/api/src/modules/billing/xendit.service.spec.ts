import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { XenditApiError, XenditService } from './xendit.service';

describe('XenditService', () => {
  let service: XenditService;

  const mockSecretKey = 'xnd_development_test_key';
  const mockCallbackToken = 'test_callback_token_abc123';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        XenditService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              if (key === 'XENDIT_SECRET_KEY') return mockSecretKey;
              if (key === 'XENDIT_WEBHOOK_CALLBACK_TOKEN') return mockCallbackToken;
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<XenditService>(XenditService);
  });

  // ---- createInvoice ----

  describe('createInvoice', () => {
    it('should call Xendit API and return invoice', async () => {
      const mockResponse = {
        id: 'inv_test_123',
        external_id: 'ext-uuid-123',
        invoice_url: 'https://checkout.xendit.co/inv_test_123',
        status: 'PENDING',
        amount: 999,
        currency: 'PHP',
        description: 'LIBERTASIAN Pro Plan — Monthly',
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockResponse),
      });

      const result = await service.createInvoice({
        amount: 999,
        currency: 'PHP',
        description: 'LIBERTASIAN Pro Plan — Monthly',
        externalId: 'ext-uuid-123',
        metadata: { organizationId: 'org-1', userId: 'user-1', planCode: 'pro', billingPeriod: 'monthly' },
        successRedirectUrl: 'https://app.com/success',
        failureRedirectUrl: 'https://app.com/cancel',
      });

      expect(result.id).toBe('inv_test_123');
      expect(result.invoice_url).toBe('https://checkout.xendit.co/inv_test_123');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.xendit.co/v2/invoices',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: expect.stringContaining('Basic'),
          }),
        }),
      );
    });

    it('should throw XenditApiError carrying the status and error_code from the body', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 409,
        text: jest.fn().mockResolvedValue(
          JSON.stringify({
            error_code: 'DUPLICATE_ERROR',
            message: 'reference_id entered has been used before',
          }),
        ),
      });

      const promise = service.createCustomer({ referenceId: 'org-1' });
      await expect(promise).rejects.toThrow('Xendit API error: 409');
      await promise.catch((err: unknown) => {
        expect(err).toBeInstanceOf(XenditApiError);
        expect((err as XenditApiError).status).toBe(409);
        expect((err as XenditApiError).errorCode).toBe('DUPLICATE_ERROR');
      });
    });

    it('should throw on Xendit API error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: jest.fn().mockResolvedValue('Validation error'),
      });

      await expect(
        service.createInvoice({
          amount: 999,
          currency: 'PHP',
          description: 'Test',
          externalId: 'ext-123',
          metadata: {},
          successRedirectUrl: 'https://app.com/success',
          failureRedirectUrl: 'https://app.com/cancel',
        }),
      ).rejects.toThrow('Xendit API error: 422');
    });
  });

  // ---- retrieveInvoice ----

  describe('retrieveInvoice', () => {
    it('should retrieve invoice by id', async () => {
      const mockInvoice = {
        id: 'inv_test_456',
        external_id: 'ext-uuid-456',
        invoice_url: 'https://checkout.xendit.co/inv_test_456',
        status: 'PENDING',
        amount: 999,
        currency: 'PHP',
        description: 'LIBERTASIAN Pro Plan',
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockInvoice),
      });

      const result = await service.retrieveInvoice('inv_test_456');

      expect(result.id).toBe('inv_test_456');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.xendit.co/v2/invoices/inv_test_456',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  // ---- createSubscriptionSession ----

  describe('createSubscriptionSession', () => {
    const params = {
      referenceId: 'sub-1',
      customerId: 'cust-1',
      amount: 999,
      currency: 'PHP',
      interval: 'MONTH' as const,
      intervalCount: 1,
      description: 'LIBERTASIAN Pro Plan — Monthly',
      successReturnUrl: 'https://app.com/success',
      cancelReturnUrl: 'https://app.com/cancel',
      metadata: { organizationId: 'org-1' },
    };

    const mockSession = {
      payment_session_id: 'ps-1',
      payment_link_url: 'https://checkout.xendit.co/sessions/ps-1',
      reference_id: 'sub-1',
    };

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should anchor the schedule at the NEXT cycle and set immediate_payment', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-04T10:15:30.123Z'));
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockSession),
      });

      await service.createSubscriptionSession(params);

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.xendit.co/sessions');
      expect(init.headers).toEqual(
        expect.objectContaining({ 'api-version': '2026-01-01' }),
      );
      const body = JSON.parse(init.body as string);
      // First charge at session completion; anchor starts the second cycle.
      expect(body.subscription.immediate_payment).toBe(true);
      expect(body.subscription.schedule).toEqual({
        interval: 'MONTH',
        interval_count: 1,
        anchor_date: '2026-08-04T10:15:30Z',
      });
    });

    it('should keep the anchor_date comfortably past the 30-min session expiry', async () => {
      const now = new Date('2026-07-04T10:15:30.123Z');
      jest.useFakeTimers().setSystemTime(now);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockSession),
      });

      await service.createSubscriptionSession(params);

      const [, init] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(init.body as string);
      const anchor = new Date(body.subscription.schedule.anchor_date);
      // Xendit requires anchor_date >= expires_at (now + 30 min); assert a
      // wide margin so the constraint can never be violated.
      expect(anchor.getTime() - now.getTime()).toBeGreaterThanOrEqual(60 * 60 * 1000);
    });

    it('should clamp the anchor day to 28 for month-end checkouts (Xendit max day is 28)', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-31T23:59:59.000Z'));
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockSession),
      });

      await service.createSubscriptionSession(params);

      const [, init] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.subscription.schedule.anchor_date).toBe('2026-08-28T23:59:59Z');
    });
  });

  // ---- subscriptionAnchorDate ----

  describe('subscriptionAnchorDate', () => {
    it('should return one month ahead for MONTH × 1', () => {
      expect(
        XenditService.subscriptionAnchorDate('MONTH', 1, new Date('2026-07-04T10:15:30.123Z')),
      ).toBe('2026-08-04T10:15:30Z');
    });

    it('should not overflow into March for Jan 31 + 1 MONTH (clamps to Feb 28)', () => {
      expect(
        XenditService.subscriptionAnchorDate('MONTH', 1, new Date('2026-01-31T08:00:00Z')),
      ).toBe('2026-02-28T08:00:00Z');
    });

    it('should return one year ahead for YEAR × 1', () => {
      expect(
        XenditService.subscriptionAnchorDate('YEAR', 1, new Date('2026-07-04T10:15:30Z')),
      ).toBe('2027-07-04T10:15:30Z');
    });

    it('should clamp a month-end annual anchor to day 28', () => {
      expect(
        XenditService.subscriptionAnchorDate('YEAR', 1, new Date('2026-12-31T09:30:00Z')),
      ).toBe('2027-12-28T09:30:00Z');
    });
  });

  // ---- getCustomerByReferenceId ----

  describe('getCustomerByReferenceId', () => {
    it('should return the first matching customer', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: [{ id: 'cust-1', reference_id: 'org-1' }],
        }),
      });

      const result = await service.getCustomerByReferenceId('org-1');

      expect(result).toEqual({ id: 'cust-1', reference_id: 'org-1' });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.xendit.co/customers?reference_id=org-1',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should return null when no customer matches', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [] }),
      });

      await expect(service.getCustomerByReferenceId('org-none')).resolves.toBeNull();
    });

    it('should URL-encode the reference id', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [] }),
      });

      await service.getCustomerByReferenceId('org/1&x=y');

      expect(global.fetch).toHaveBeenCalledWith(
        `https://api.xendit.co/customers?reference_id=${encodeURIComponent('org/1&x=y')}`,
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  // ---- verifyWebhookToken ----

  describe('verifyWebhookToken', () => {
    it('should verify valid callback token', () => {
      const result = service.verifyWebhookToken(mockCallbackToken);
      expect(result).toBe(true);
    });

    it('should reject invalid callback token', () => {
      const result = service.verifyWebhookToken('wrong_token');
      expect(result).toBe(false);
    });

    it('should return false for empty callback token', () => {
      const result = service.verifyWebhookToken('');
      expect(result).toBe(false);
    });
  });

  // ---- parseWebhookEvent ----

  describe('parseWebhookEvent', () => {
    it('should parse webhook event from raw body', () => {
      const event = {
        id: 'inv_test_123',
        external_id: 'ext-uuid-123',
        status: 'PAID',
        paid_amount: 999,
        amount: 999,
        currency: 'PHP',
        description: 'LIBERTASIAN Pro Plan — Monthly',
      };

      const rawBody = JSON.stringify(event);
      const result = service.parseWebhookEvent(rawBody);

      expect(result.id).toBe('inv_test_123');
      expect(result.status).toBe('PAID');
      expect(result.paid_amount).toBe(999);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});
