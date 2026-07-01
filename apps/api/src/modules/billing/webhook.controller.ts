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
  XENDIT_RECURRING_EVENTS,
  type XenditRefundData,
  type XenditRefundWebhookEvent,
  type XenditRecurringData,
  type XenditRecurringWebhookEvent,
  type XenditWebhookEvent,
} from './xendit.service';
import { BillingService } from './billing.service';
import { AuditService } from '../audit/audit.service';

const RECURRING_EVENT_PREFIXES = ['recurring.', 'payment.'];

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

    // Verify webhook callback token (shared by all event shapes).
    const isValid = this.xenditService.verifyWebhookToken(callbackToken);
    if (!isValid) {
      this.logger.warn('Invalid Xendit webhook callback token');
      throw new BadRequestException('Invalid callback token');
    }

    // Parse the event, then dispatch on payload shape (verification is shared).
    // There are three shapes on the single POST /billing/webhooks/xendit endpoint:
    //   - flat invoice   ({ id, status })              → invoice handler
    //   - envelope refund ({ event: 'refund.*', data }) → refund handler
    //   - envelope recurring ({ event: 'recurring.*'|'payment.*', data })
    //                                                   → recurring handler
    const parsed = this.xenditService.parseWebhookEvent(rawBody) as XenditWebhookEvent &
      Partial<XenditRefundWebhookEvent> &
      Partial<XenditRecurringWebhookEvent>;

    if (typeof parsed.event === 'string') {
      if (parsed.event.startsWith('refund.')) {
        return this.handleRefundWebhook(parsed.event, parsed.data as XenditRefundData);
      }
      if (RECURRING_EVENT_PREFIXES.some((p) => parsed.event!.startsWith(p))) {
        return this.handleRecurringWebhook(parsed.event, parsed.data as XenditRecurringData);
      }
    }

    return this.handleInvoiceWebhook(parsed);
  }

  /** Flat invoice webhook path (PAID / EXPIRED). */
  private async handleInvoiceWebhook(event: XenditWebhookEvent) {
    const eventId = event.id;
    const eventStatus = event.status;

    // Idempotency keyed by event KIND + id so events of different kinds for the
    // same id (an invoice vs. a later refund or recurring event) never collide.
    const idempotencyKey = `billing:webhook:invoice:${eventId}`;
    if (await this.redisService.get(idempotencyKey)) {
      this.logger.log(`Webhook event already processed: invoice ${eventId}`);
      return { received: true };
    }
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
      await this.redisService.del(idempotencyKey);
      this.logger.error(`Webhook processing failed: ${eventStatus}`, err);
      throw err;
    }

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

  /** Recurring subscription webhook path (envelope). */
  private async handleRecurringWebhook(eventName: string, data: XenditRecurringData) {
    const dataId = data?.id;
    if (!dataId) {
      this.logger.warn(`Recurring webhook ${eventName} missing data.id — acknowledging`);
      return { received: true };
    }

    // Same event-kind idempotency scheme: billing:webhook:<eventName>:<id>.
    const idempotencyKey = `billing:webhook:${eventName}:${dataId}`;
    if (await this.redisService.get(idempotencyKey)) {
      this.logger.log(`Webhook event already processed: ${eventName} ${dataId}`);
      return { received: true };
    }
    await this.redisService.set(idempotencyKey, '1', 7 * 24 * 60 * 60);

    this.logger.log(`Processing Xendit recurring webhook: ${eventName} id=${dataId}`);

    try {
      switch (eventName) {
        case XENDIT_RECURRING_EVENTS.PLAN_ACTIVATED:
          await this.billingService.handleSubscriptionActivated(data);
          break;
        case XENDIT_RECURRING_EVENTS.CYCLE_SUCCEEDED:
          // AUTHORITATIVE cycle signal. `recurring.cycle.succeeded` is the SINGLE
          // source of truth for advancing currentPeriodEnd and recording the
          // subscription Payment for a charged cycle — including the first
          // (activation) charge, for which Xendit also emits cycle.succeeded.
          await this.billingService.handleCycleSucceeded(data);
          break;
        case XENDIT_RECURRING_EVENTS.PAYMENT_SUCCEEDED:
          // LOG-ONLY (informational). `payment.succeeded` is the lower-level
          // capture event that fires alongside `recurring.cycle.succeeded` for
          // the same charge, but carries a DIFFERENT `data.id` (the payment id,
          // not the cycle id). Routing it into handleCycleSucceeded would defeat
          // the cycle-id idempotency check (the two ids never dedup against each
          // other) and record a second Payment + advance the period twice. The
          // cycle event owns the period advance and the Payment; do NOT act here.
          this.logger.log(
            `payment.succeeded ${dataId} (informational) — cycle.succeeded is authoritative; not advancing period`,
          );
          break;
        case XENDIT_RECURRING_EVENTS.CYCLE_FAILED:
          await this.billingService.handleCycleFailed(data);
          break;
        case XENDIT_RECURRING_EVENTS.PLAN_INACTIVATED:
          await this.billingService.handlePlanDeactivated(data);
          break;
        case XENDIT_RECURRING_EVENTS.CYCLE_CREATED:
          // Informational — Xendit is about to attempt the charge. No-op.
          this.logger.log(`Recurring cycle created for ${dataId}`);
          break;
        default:
          this.logger.log(`Unhandled Xendit recurring event: ${eventName}`);
      }
    } catch (err) {
      await this.redisService.del(idempotencyKey);
      this.logger.error(`Recurring webhook processing failed: ${eventName}`, err);
      throw err;
    }

    await this.auditService.log({
      actorType: 'system',
      action: `billing.webhook.xendit.${eventName.replace(/\./g, '_')}`,
      entityType: 'webhook_event',
      entityId: dataId,
      // PII-safe: ids + status only.
      metadata: {
        event: eventName,
        planId: data.plan_id ?? data.recurring_plan_id,
        status: data.status,
      },
    });

    return { received: true };
  }
}
