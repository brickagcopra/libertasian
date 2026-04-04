import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface XenditInvoiceParams {
  amount: number;
  currency: string;
  description: string;
  externalId: string;
  metadata: Record<string, string>;
  successRedirectUrl: string;
  failureRedirectUrl: string;
}

export interface XenditInvoice {
  id: string;
  external_id: string;
  invoice_url: string;
  status: string;
  amount: number;
  currency: string;
  description: string;
}

export interface XenditWebhookEvent {
  id: string;
  external_id: string;
  status: string;
  paid_amount?: number;
  amount: number;
  currency: string;
  description: string;
  [key: string]: unknown;
}

@Injectable()
export class XenditService {
  private readonly logger = new Logger(XenditService.name);
  private readonly baseUrl = 'https://api.xendit.co';
  private readonly secretKey: string;
  private readonly webhookCallbackToken: string;

  constructor(private readonly config: ConfigService) {
    this.secretKey = this.config.get<string>('XENDIT_SECRET_KEY', '');
    this.webhookCallbackToken = this.config.get<string>('XENDIT_WEBHOOK_CALLBACK_TOKEN', '');
  }

  /**
   * Create a Xendit Invoice.
   * Returns the invoice object with invoice_url for redirect.
   */
  async createInvoice(params: XenditInvoiceParams): Promise<XenditInvoice> {
    const body = {
      external_id: params.externalId,
      amount: params.amount,
      currency: params.currency,
      description: params.description,
      success_redirect_url: params.successRedirectUrl,
      failure_redirect_url: params.failureRedirectUrl,
      invoice_duration: 1800,
      payment_methods: ['CREDIT_CARD', 'GCASH', 'GRABPAY', 'PAYMAYA'],
      metadata: params.metadata,
    };

    return this.request<XenditInvoice>('POST', '/v2/invoices', body);
  }

  /**
   * Retrieve an invoice by ID.
   */
  async retrieveInvoice(id: string): Promise<XenditInvoice> {
    return this.request<XenditInvoice>('GET', `/v2/invoices/${id}`);
  }

  /**
   * Verify webhook callback token.
   * Xendit sends the token via X-CALLBACK-TOKEN header.
   * Verification is a simple constant-time string comparison.
   */
  verifyWebhookToken(callbackToken: string): boolean {
    if (!callbackToken || !this.webhookCallbackToken) {
      this.logger.warn('Webhook callback token missing');
      return false;
    }

    const tokenBuffer = Buffer.from(callbackToken);
    const expectedBuffer = Buffer.from(this.webhookCallbackToken);

    if (tokenBuffer.length !== expectedBuffer.length) {
      return false;
    }

    try {
      const crypto = require('crypto') as typeof import('crypto');
      return crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Parse a webhook event payload.
   * Xendit sends a flat JSON payload (no nested wrapper).
   */
  parseWebhookEvent(rawBody: string): XenditWebhookEvent {
    return JSON.parse(rawBody) as XenditWebhookEvent;
  }

  /**
   * Internal HTTP request helper using native fetch.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const authHeader = Buffer.from(`${this.secretKey}:`).toString('base64');
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${authHeader}`,
    };

    const response = await fetch(url, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(
        `Xendit API error: ${response.status} ${method} ${path} — ${errorBody}`,
      );
      throw new Error(`Xendit API error: ${response.status}`);
    }

    return (await response.json()) as T;
  }
}
