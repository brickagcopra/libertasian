import {
  BadRequestException,
  Controller,
  Headers,
  Logger,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';

import { RedisService } from '../../common/services/redis.service';
import {
  XenditService,
  type XenditRefundData,
  type XenditRefundWebhookEvent,
  type XenditWebhookEvent,
} from './xendit.service';
import { BillingService } from './billing.service';
import { AuditService } from '../audit/audit.service';

@ApiExcludeController()
@Controller('billing/webhooks')
@SkipThrottle()
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly xenditService: XenditService,
    private readonly billingService: BillingService,
    private readonly auditService: AuditService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Public endpoint — no auth guard.
   * Xendit sends webhook callback events here.
   * Must configure NestJS to preserve raw body for token verification.
   */
  @Post('xendit')
  async handleXenditWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-callback-token') callbackToken: string,
  ) {
    const rawBody = req.rawBody?.toString();
    if (!rawBody) {
      throw new BadRequestException('Missing request body');
    }

    if (!callbackToken) {
      throw new BadRequestException('Missing webhook callback token');
    }

    // Verify webhook callback token
    const isValid = this.xenditService.verifyWebhookToken(callbackToken);
    if (!isValid) {
      this.logger.warn('Invalid Xendit webhook callback token');
      throw new BadRequestException('Invalid callback token');
    }

    // Parse the event. Invoice webhooks are flat ({ id, status, ... });
    // refund webhooks are an envelope ({ event: 'refund.*', data: {...} }).
    const parsed = this.xenditService.parseWebhookEvent(rawBody) as XenditWebhookEvent &
      Partial<XenditRefundWebhookEvent>;

    // Branch on payload shape AFTER token verification (verification is shared).
    if (typeof parsed.event === 'string' && parsed.event.startsWith('refund.')) {
      return this.handleRefundWebhook(parsed.event, parsed.data as XenditRefundData);
    }

    return this.handleInvoiceWebhook(parsed);
  }

  /** Flat invoice webhook path (PAID / EXPIRED). */
  private async handleInvoiceWebhook(event: XenditWebhookEvent) {
    const eventId = event.id;
    const eventStatus = event.status;

    // Idempotency check — keyed by event KIND + invoice id so a refund webhook
    // for the same invoice cannot collide with the original PAID/EXPIRED event.
    const idempotencyKey = `billing:webhook:invoice:${eventId}`;
    const alreadyProcessed = await this.redisService.get(idempotencyKey);
    if (alreadyProcessed) {
      this.logger.log(`Webhook event already processed: invoice ${eventId}`);
      return { received: true };
    }

    // Mark as processing (7-day TTL)
    await this.redisService.set(idempotencyKey, '1', 7 * 24 * 60 * 60);

    this.logger.log(`Processing Xendit webhook: invoice ${eventId} status=${eventStatus}`);

    try {
      switch (eventStatus) {
        case 'PAID': {
          await this.billingService.handlePaymentSuccess(
            event as unknown as Record<string, unknown>,
          );
          break;
        }
        case 'EXPIRED': {
          await this.billingService.handlePaymentFailed(
            event as unknown as Record<string, unknown>,
          );
          break;
        }
        default:
          this.logger.log(`Unhandled Xendit invoice status: ${eventStatus}`);
      }
    } catch (err) {
      // Remove idempotency key on failure so it can be retried
      await this.redisService.del(idempotencyKey);
      this.logger.error(`Webhook processing failed: ${eventStatus}`, err);
      throw err;
    }

    // Audit log all webhook events
    await this.auditService.log({
      actorType: 'system',
      action: `billing.webhook.xendit.${eventStatus?.toLowerCase()}`,
      entityType: 'webhook_event',
      entityId: eventId,
      metadata: { status: eventStatus },
    });

    return { received: true };
  }

  /** Envelope refund webhook path (refund.succeeded / refund.failed). */
  private async handleRefundWebhook(eventName: string, data: XenditRefundData) {
    const refundId = data?.id;
    if (!refundId) {
      // No refund id → no idempotency key and nothing to link. Don't throw
      // (throwing triggers Xendit retries); log and acknowledge.
      this.logger.warn('Refund webhook missing data.id — acknowledging without processing');
      return { received: true };
    }

    // Idempotency keyed by refund id so it never collides with invoice events
    // for the same invoice.
    const idempotencyKey = `billing:webhook:refund:${refundId}`;
    const alreadyProcessed = await this.redisService.get(idempotencyKey);
    if (alreadyProcessed) {
      this.logger.log(`Webhook event already processed: refund ${refundId}`);
      return { received: true };
    }
    await this.redisService.set(idempotencyKey, '1', 7 * 24 * 60 * 60);

    this.logger.log(`Processing Xendit refund webhook: ${eventName} refund=${refundId}`);

    const isSuccess = eventName === 'refund.succeeded';
    try {
      if (isSuccess) {
        await this.billingService.handleRefundSucceeded(data);
      } else {
        // refund.failed → audit + structured warn only. No entitlement change:
        // the original charge stands, so the subscription is untouched.
        this.logger.warn(
          `Xendit refund failed: refund=${refundId} invoice=${data.invoice_id ?? 'n/a'} status=${data.status}`,
        );
      }
    } catch (err) {
      await this.redisService.del(idempotencyKey);
      this.logger.error(`Refund webhook processing failed: ${eventName}`, err);
      throw err;
    }

    await this.auditService.log({
      actorType: 'system',
      action: isSuccess
        ? 'billing.webhook.xendit.refund_succeeded'
        : 'billing.webhook.xendit.refund_failed',
      entityType: 'webhook_event',
      entityId: refundId,
      // PII-safe: ids + status only, no customer/contact data.
      metadata: {
        event: eventName,
        invoiceId: data.invoice_id,
        status: data.status,
      },
    });

    return { received: true };
  }
}
