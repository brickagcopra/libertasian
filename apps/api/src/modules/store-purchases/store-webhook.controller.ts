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
import { AuditService } from '../audit/audit.service';
import {
  STORE_PURCHASE_PROVIDER,
  type StorePurchaseProvider,
} from './store-purchase-provider.interface';
import { StorePurchasesService } from './store-purchases.service';

/** Matches the existing WebhookController's Redis window. */
const IDEMPOTENCY_TTL_SEC = 7 * 24 * 60 * 60;

/**
 * `POST /store/webhooks/:conduit` — deliberately NOT under `billing/webhooks`.
 *
 * `WebhookController` is `@Controller('billing/webhooks')` with `@Post(':provider')`,
 * and its `resolveProvider()` 404s any slug that is not the single bound
 * `PAYMENT_PROVIDER`. Mounting the store conduit at
 * `billing/webhooks/revenuecat` would be swallowed by that route and rejected
 * before this controller ever saw it — a routing collision that would only show
 * up at runtime. A separate prefix avoids it. See D4.
 *
 * `main.ts` already sets `rawBody: true`, so no bootstrap change was needed.
 */
@ApiExcludeController()
@Controller('store/webhooks')
// A store's retry storm must not be rate-limited into failure. Copied
// deliberately from the existing webhook controller.
@SkipThrottle()
export class StoreWebhookController {
  private readonly logger = new Logger(StoreWebhookController.name);

  constructor(
    @Inject(STORE_PURCHASE_PROVIDER)
    private readonly storeProvider: StorePurchaseProvider,
    private readonly storePurchasesService: StorePurchasesService,
    private readonly auditService: AuditService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Public endpoint — no auth guard. The conduit posts store events here and
   * authenticates with a configured `Authorization` header value, NOT an HMAC
   * over the body.
   */
  @Post(':conduit')
  async handleStoreWebhook(
    @Param('conduit') conduit: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const adapter = this.resolveConduit(conduit);

    const rawBody = req.rawBody?.toString();
    if (!rawBody) {
      throw new BadRequestException('Missing request body');
    }

    // Two distinct 400 messages for a missing vs. a wrong credential, matching
    // the existing controller. Neither reveals the expected value.
    const verification = adapter.verifyWebhookAuthorization(
      req.headers as Record<string, string | undefined>,
    );
    if (verification === 'missing') {
      throw new BadRequestException('Missing webhook authorization header');
    }
    if (verification !== 'valid') {
      this.logger.warn(`Invalid ${adapter.slug} webhook authorization`);
      throw new BadRequestException('Invalid webhook authorization');
    }

    const event = adapter.parseStoreEvent(rawBody);

    if (!event.eventId) {
      // No id → no idempotency key and nothing to link. Do NOT throw: throwing
      // triggers conduit retries of an event that can never be deduplicated.
      this.logger.warn(
        `Store webhook ${event.providerEventName} missing event id — acknowledging without processing`,
      );
      return { received: true };
    }

    // The HOT idempotency path. The DURABLE one is the UNIQUE index on
    // store_webhook_events.rc_event_id, checked inside the service — this Redis
    // key only spares us the round trip during the conduit's ~155-minute retry
    // window, and it runs on a `noeviction` cache with a TTL, i.e. it is not a
    // record. A refund arriving 60 days later has no key here at all.
    const idempotencyKey = `store:webhook:${event.eventId}`;
    if (await this.redisService.get(idempotencyKey)) {
      this.logger.log(`Store webhook event already processed: ${event.eventId}`);
      return { received: true };
    }
    await this.redisService.set(idempotencyKey, '1', IDEMPOTENCY_TTL_SEC);

    let outcome;
    try {
      outcome = await this.storePurchasesService.handleStoreEvent(event);
    } catch (err) {
      // Drop the hot key so the conduit's retry can re-process. The durable row
      // keeps `processed_at = NULL` for the same reason.
      await this.redisService.del(idempotencyKey);
      this.logger.error(`Store webhook processing failed: ${event.providerEventName}`, err);
      throw err;
    }

    await this.auditService.log({
      actorType: 'system',
      // Mirrors the existing `billing.webhook.<provider>.<suffix>` convention.
      action: `billing.webhook.${adapter.slug}.${event.providerEventName.toLowerCase()}`,
      entityType: 'store_webhook_event',
      entityId: event.eventId,
      // PII-safe: ids, slugs and statuses only. The App User ID is an org uuid
      // (D11), so there is no email to redact.
      metadata: { ...event.auditMetadata, outcome: outcome.status, detail: outcome.detail },
    });

    return { received: true };
  }

  /**
   * Resolve the adapter for a `:conduit` path segment. An unknown slug 404s
   * rather than being silently processed by the wrong adapter's verifier.
   */
  private resolveConduit(slug: string): StorePurchaseProvider {
    if (slug.toLowerCase() !== this.storeProvider.slug) {
      throw new NotFoundException(`Unknown store conduit: ${slug}`);
    }
    return this.storeProvider;
  }
}
