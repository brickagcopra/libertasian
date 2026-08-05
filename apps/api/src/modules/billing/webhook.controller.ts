import {
  BadRequestException,
  Controller,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';

import { RedisService } from '../../common/services/redis.service';
import {
  PAYMENT_PROVIDER,
  type NormalizedWebhookEvent,
  type PaymentEventData,
  type PaymentProvider,
  type RefundEventData,
  type SubscriptionEventData,
} from './payment-provider.interface';
import { BillingService } from './billing.service';
import { AuditService } from '../audit/audit.service';

@ApiExcludeController()
@Controller('billing/webhooks')
@SkipThrottle()
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
    private readonly billingService: BillingService,
    private readonly auditService: AuditService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Public endpoint — no auth guard. The gateway posts callback events here.
   * NestJS must be configured to preserve the raw body for signature/token
   * verification.
   *
   * `:provider` is the gateway slug. The previously hard-coded
   * `/billing/webhooks/xendit` path is therefore still served unchanged — the
   * URL already configured in the Xendit dashboard keeps working — and adding
   * PayMongo later only means registering a second adapter.
   */
  @Post(':provider')
  async handleWebhook(
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const adapter = this.resolveProvider(provider);

    const rawBody = req.rawBody?.toString();
    if (!rawBody) {
      throw new BadRequestException('Missing request body');
    }

    // Verification is per-provider: Xendit compares a shared `x-callback-token`
    // header; an HMAC-signing gateway would hash the raw body instead. Both
    // inputs are handed over and the adapter takes what it needs.
    const verification = adapter.verifyWebhookSignature(
      rawBody,
      req.headers as Record<string, string | undefined>,
    );
    if (verification === 'missing') {
      throw new BadRequestException('Missing webhook callback token');
    }
    if (verification !== 'valid') {
      this.logger.warn(`Invalid ${adapter.slug} webhook callback token`);
      throw new BadRequestException('Invalid callback token');
    }

    // The adapter translates its own payload shapes into the internal event
    // vocabulary, so nothing below this line knows a gateway's event strings.
    const event = adapter.parseWebhookEvent(rawBody);
    return this.dispatch(event);
  }

  /**
   * Resolve the adapter for a `:provider` path segment.
   *
   * Only one gateway is wired today; an unknown slug 404s rather than being
   * silently processed by the wrong adapter's verifier.
   */
  private resolveProvider(slug: string): PaymentProvider {
    if (slug.toLowerCase() !== this.paymentProvider.slug) {
      throw new NotFoundException(`Unknown payment provider: ${slug}`);
    }
    return this.paymentProvider;
  }

  /**
   * Idempotency → handler → audit, shared by every event kind.
   *
   * The Redis key (`billing:webhook:<scope>:<entityId>`) and the audit action
   * (`billing.webhook.<provider>.<suffix>`) are built from adapter-supplied
   * fields, so both stay byte-identical to the pre-abstraction behaviour.
   */
  private async dispatch(event: NormalizedWebhookEvent) {
    const entityId = event.entityId;
    if (!entityId) {
      // No id → no idempotency key and nothing to link. Don't throw (throwing
      // triggers gateway retries); log and acknowledge.
      this.logger.warn(
        `Webhook ${event.providerEventName} missing event id — acknowledging without processing`,
      );
      return { received: true };
    }

    // Idempotency keyed by event KIND + id so events of different kinds for the
    // same id (an invoice vs. a later refund or recurring event) never collide.
    const idempotencyKey = `billing:webhook:${event.idempotencyScope}:${entityId}`;
    if (await this.redisService.get(idempotencyKey)) {
      this.logger.log(
        `Webhook event already processed: ${event.idempotencyScope} ${entityId}`,
      );
      return { received: true };
    }
    await this.redisService.set(idempotencyKey, '1', 7 * 24 * 60 * 60);

    this.logger.log(
      `Processing ${event.provider} webhook: ${event.providerEventName} id=${entityId}`,
    );

    try {
      await this.route(event);
    } catch (err) {
      await this.redisService.del(idempotencyKey);
      this.logger.error(`Webhook processing failed: ${event.providerEventName}`, err);
      throw err;
    }

    await this.auditService.log({
      actorType: 'system',
      action: `billing.webhook.${event.provider}.${event.auditSuffix}`,
      entityType: 'webhook_event',
      entityId,
      // PII-safe: ids + status only, no customer/contact data.
      metadata: event.auditMetadata,
    });

    return { received: true };
  }

  /** Route a normalized event to its BillingService handler. */
  private async route(event: NormalizedWebhookEvent): Promise<void> {
    switch (event.type) {
      case 'payment.succeeded':
        await this.billingService.handlePaymentSuccess(event.data as PaymentEventData);
        return;
      case 'payment.failed':
      case 'payment.expired':
        await this.billingService.handlePaymentFailed(event.data as PaymentEventData);
        return;
      case 'refund.succeeded':
        await this.billingService.handleRefundSucceeded(event.data as RefundEventData);
        return;
      case 'refund.failed': {
        // Audit + structured warn only. No entitlement change: the original
        // charge stands, so the subscription is untouched.
        const data = event.data as RefundEventData;
        this.logger.warn(
          `Refund failed: refund=${data.id} invoice=${data.invoiceId ?? 'n/a'} status=${data.status}`,
        );
        return;
      }
      case 'subscription.activated':
        await this.billingService.handleSubscriptionActivated(
          event.data as SubscriptionEventData,
        );
        return;
      case 'subscription.cycle.succeeded':
        // AUTHORITATIVE cycle signal. This is the SINGLE source of truth for
        // advancing currentPeriodEnd and recording the subscription Payment for
        // a charged cycle — including the first (activation) charge, for which
        // the gateway also emits a cycle-succeeded event.
        await this.billingService.handleCycleSucceeded(event.data as SubscriptionEventData);
        return;
      case 'payment.captured':
        // LOG-ONLY (informational). The lower-level capture event fires
        // alongside the cycle-succeeded event for the same charge, but carries a
        // DIFFERENT id (the payment id, not the cycle id). Routing it into
        // handleCycleSucceeded would defeat the cycle-id idempotency check (the
        // two ids never dedup against each other) and record a second Payment +
        // advance the period twice. The cycle event owns the period advance and
        // the Payment; do NOT act here.
        this.logger.log(
          `${event.providerEventName} ${event.entityId} (informational) — cycle-succeeded is authoritative; not advancing period`,
        );
        return;
      case 'subscription.cycle.failed':
        await this.billingService.handleCycleFailed(event.data as SubscriptionEventData);
        return;
      case 'subscription.deactivated':
        await this.billingService.handlePlanDeactivated(event.data as SubscriptionEventData);
        return;
      case 'subscription.cycle.created':
        // Informational — the gateway is about to attempt the charge. No-op.
        this.logger.log(`Recurring cycle created for ${event.entityId}`);
        return;
      default:
        this.logger.log(
          `Unhandled ${event.provider} webhook event: ${event.providerEventName}`,
        );
    }
  }
}
