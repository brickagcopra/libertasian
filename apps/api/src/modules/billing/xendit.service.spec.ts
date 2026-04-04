import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { XenditService } from './xendit.service';

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
