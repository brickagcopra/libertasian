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
import { XenditService } from './xendit.service';
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

    // Parse the event — Xendit sends flat JSON
    const event = this.xenditService.parseWebhookEvent(rawBody);
    const eventId = event.id;
    const eventStatus = event.status;

    // Idempotency check — store processed event IDs in Redis (7-day TTL)
    const idempotencyKey = `billing:webhook:${eventId}`;
    const alreadyProcessed = await this.redisService.get(idempotencyKey);
    if (alreadyProcessed) {
      this.logger.log(`Webhook event already processed: ${eventId}`);
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
}
