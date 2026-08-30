import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PAYMENT_PROVIDERS } from '../billing/payment-provider.interface';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { SubscriptionLifecycleService } from '../subscriptions/subscription-lifecycle.service';
import {
  ACCESSIBLE_STATE_VALUES,
  SubscriptionAction,
  SubscriptionState,
} from '../subscriptions/subscription-state-machine';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { resolveStoreEvent, type StoreResolution } from './store-event-resolver';
import {
  resolveStoreProduct,
  STORE_PRODUCT_IDS,
  STORE_PRODUCT_MAP,
  type StoreProductDefinition,
} from './store-product-map';
import {
  isStoreProviderSlug,
  STORE_PROVIDERS,
  STORE_PURCHASE_PROVIDER,
  type NormalizedStoreEvent,
  type StorePurchaseProvider,
} from './store-purchase-provider.interface';

/**
 * Finding (f): the `trial_expiry` scheduled event is OURS, but the trial is the
 * STORE's. Our job could otherwise fire first — clock skew, or a store-side
 * extension — and expire a trial the store still considers live. Stamping
 * `trialEnd` a day PAST the store's own expiry makes the store event always win
 * and reduces our job to a backstop for a webhook that never arrived.
 */
const TRIAL_EXPIRY_BACKSTOP_MS = 24 * 60 * 60 * 1000;

/** How long a store transaction is presumed to run when the event omits an expiry. */
const DEFAULT_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export interface StoreEventOutcome {
  received: true;
  /** What actually happened, so a caller (and a test) can assert the no-op. */
  status:
    | 'processed'
    | 'duplicate'
    | 'ignored_sandbox'
    | 'ignored_production'
    | 'unmapped_product'
    | 'unresolved_org'
    | 'noop';
  detail?: string;
}

export interface PurchaseIntentResult {
  /** The RevenueCat App User ID the client must `logIn()` with. See D11. */
  appUserId: string;
  products: (StoreProductDefinition & { productId: string })[];
}

interface StoreSubscriptionRow {
  id: string;
  organizationId: string;
  planCode: string;
  status: string;
  provider: string;
  providerSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

@Injectable()
export class StorePurchasesService {
  private readonly logger = new Logger(StorePurchasesService.name);

  constructor(
    @Inject(STORE_PURCHASE_PROVIDER)
    private readonly storeProvider: StorePurchaseProvider,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly lifecycleService: SubscriptionLifecycleService,
    private readonly entitlementService: EntitlementService,
    private readonly config: ConfigService,
  ) {}

  // ======================================================================
  // Webhook entry point
  // ======================================================================

  /**
   * Persist → resolve → act, in that order.
   *
   * The event is written to `store_webhook_events` BEFORE anything else, so an
   * event we then fail to process is still on the record. The `UNIQUE` on
   * `rc_event_id` is what makes a replay a no-op — not a Redis key, not a
   * status check. See §9.
   */
  async handleStoreEvent(event: NormalizedStoreEvent): Promise<StoreEventOutcome> {
    const organizationId = await this.resolveOrganizationId(event.appUserId);

    const record = await this.recordWebhookEvent(event, organizationId);
    if (record.duplicate) {
      this.logger.log(
        `Store webhook ${event.providerEventName} ${event.eventId} already processed — acknowledging`,
      );
      return { received: true, status: 'duplicate' };
    }

    try {
      const outcome = await this.processEvent(event, organizationId);
      await this.markProcessed(record.id, outcome);
      return outcome;
    } catch (err) {
      // Record WHY, then rethrow so the conduit retries. The row keeps
      // `processed_at = NULL`, which is exactly what makes the retry
      // re-processable rather than being swallowed as a duplicate.
      await this.markFailed(record.id, err);
      throw err;
    }
  }

  private async processEvent(
    event: NormalizedStoreEvent,
    organizationId: string | null,
  ): Promise<StoreEventOutcome> {
    // ---- D10: sandbox never grants production entitlement ----
    const sandboxOutcome = this.checkEnvironment(event);
    if (sandboxOutcome) return sandboxOutcome;

    if (!organizationId) {
      // Recorded, never dropped. An unresolvable App User ID is a
      // misconfiguration to investigate, not a reason to make the conduit
      // retry forever.
      this.logger.warn(
        `Store webhook ${event.providerEventName} for unresolvable app_user_id — recorded, not applied`,
      );
      return { received: true, status: 'unresolved_org' };
    }

    // TRANSFER is the one event the §4 resolver cannot decide on its own: it is
    // about TWO orgs, and `resolveStoreEvent` is a function of ONE org's current
    // state. Routing it here rather than through `applyResolution` also means an
    // unresolvable `app_user_id` does not bail out a transfer whose
    // `transferred_to` we CAN resolve — handleTransfer resolves both ends itself.
    if (event.type === 'purchase.transferred') {
      return this.handleTransfer(event);
    }

    const subscription = await this.findStoreSubscription(organizationId);
    const resolution = resolveStoreEvent({
      type: event.type,
      currentState: subscription ? (subscription.status as SubscriptionState) : null,
      periodType: event.periodType,
      cancelReason: event.cancelReason,
    });

    return this.applyResolution(resolution, event, organizationId, subscription);
  }

  /**
   * D10, both directions.
   *
   * In production a SANDBOX event is persisted, acknowledged with a 200, and
   * otherwise ignored — a sandbox tester's Apple ID can drive an
   * `INITIAL_PURCHASE` against the production webhook if the conduit project is
   * misconfigured, and a non-2xx would only make it retry something we will
   * never accept. Outside production the mirror rule applies, so a stray
   * production event cannot move a staging subscription either.
   */
  private checkEnvironment(event: NormalizedStoreEvent): StoreEventOutcome | null {
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';

    if (isProduction && event.environment === 'sandbox') {
      this.logger.warn(
        `Sandbox store event ${event.providerEventName} ${event.eventId} received in production — recorded, not applied`,
      );
      return { received: true, status: 'ignored_sandbox' };
    }
    if (!isProduction && event.environment === 'production') {
      this.logger.warn(
        `Production store event ${event.providerEventName} ${event.eventId} received outside production — recorded, not applied`,
      );
      return { received: true, status: 'ignored_production' };
    }
    return null;
  }

  // ======================================================================
  // Applying a resolution
  // ======================================================================

  private async applyResolution(
    resolution: StoreResolution,
    event: NormalizedStoreEvent,
    organizationId: string,
    subscription: StoreSubscriptionRow | null,
  ): Promise<StoreEventOutcome> {
    switch (resolution.kind) {
      case 'create':
        return this.createStoreSubscription(event, organizationId, resolution.action);

      case 'transition':
        if (!subscription) return { received: true, status: 'noop', detail: 'no_subscription' };
        return this.runTransition(resolution.action, event, subscription);

      case 'extend_period':
        if (!subscription) return { received: true, status: 'noop', detail: 'no_subscription' };
        await this.applyPeriodFromEvent(subscription.id, event);
        await this.entitlementService.invalidateEntitlementCache(organizationId);
        return { received: true, status: 'processed', detail: 'period_extended' };

      case 'record_pending_product':
        await this.recordPendingProduct(event, organizationId);
        return { received: true, status: 'processed', detail: 'pending_product_recorded' };

      case 'transfer':
        return this.handleTransfer(event);

      case 'noop':
      default: {
        const reason = resolution.kind === 'noop' ? resolution.reason : 'unknown';
        // §4.2 (a): the no-op is not the whole story. Auto-renew really was
        // turned off, and the store_purchases row must say so even though the
        // subscription state is deliberately unchanged.
        if (reason === 'cancellation_during_trial') {
          await this.markAutoRenewOff(event, organizationId);
        }
        // §4.1 row 33: we sell no consumables and run no experiments, so one of
        // these in production is a signal — warn rather than log at info.
        if (reason === 'informational' || reason === 'unknown_event') {
          this.logger.warn(
            `Store event ${event.providerEventName} ${event.eventId} acknowledged with no action (${reason})`,
          );
        } else {
          this.logger.log(
            `Store event ${event.providerEventName} ${event.eventId} resolved to no-op: ${reason}`,
          );
        }
        return { received: true, status: 'noop', detail: reason };
      }
    }
  }

  // ---- create (§4.1 rows 1, 2, 4) ----

  private async createStoreSubscription(
    event: NormalizedStoreEvent,
    organizationId: string,
    action: SubscriptionAction.ACTIVATE | SubscriptionAction.START_TRIAL,
  ): Promise<StoreEventOutcome> {
    const product = resolveStoreProduct(event.productId);
    if (!product) {
      // D7's enforcement point. An unmapped product id is RECORDED AND REFUSED:
      // there is no entry in the map that resolves to `team` or `enterprise`, so
      // no store event — however malformed or hostile — can unlock them.
      this.logger.warn(
        `Store event ${event.eventId} carries unmapped product ${event.productId} — refused`,
      );
      await this.auditService.log({
        organizationId,
        actorType: 'system',
        action: 'billing.iap.unmapped_product',
        entityType: 'store_webhook_event',
        entityId: event.eventId,
        metadata: event.auditMetadata,
      });
      return { received: true, status: 'unmapped_product' };
    }

    const store = event.store;
    if (!store) {
      return { received: true, status: 'noop', detail: 'unknown_store' };
    }

    // §6.1 — the race: a web checkout completed between purchase-intent and
    // purchase, or an old client skipped the intent call entirely.
    await this.enforceDoubleBillingGuard(organizationId, event);

    // §5.2 — an org that grew between intent and purchase. HONOUR IT: the money
    // is already taken and cannot be returned by us. Refusing entitlement for a
    // completed store purchase is the one failure mode that gets an app pulled.
    await this.flagMultiMemberGrant(organizationId, event, product);

    const purchasedAt = event.purchasedAt ?? new Date();
    const expiresAt = event.expiresAt ?? new Date(purchasedAt.getTime() + DEFAULT_PERIOD_MS);
    const isTrial = action === SubscriptionAction.START_TRIAL;

    const providerSubscriptionId = await this.claimProviderSubscriptionId(
      event.originalTransactionId,
      organizationId,
    );

    const subscription = await this.prisma.subscription.create({
      data: {
        organizationId,
        planCode: product.planCode,
        // PROVISIONING is deliberately not accessible: the row must not resolve
        // to its tier until the transition below succeeds.
        status: SubscriptionState.PROVISIONING,
        billingPeriod: product.billingPeriod,
        seats: 1,
        // The STORE, not the conduit. `provider` is varchar(20) with no CHECK
        // constraint, so this needed no DDL.
        provider: store,
        // D11 — the App User ID IS the organization id.
        providerCustomerId: event.appUserId,
        providerSubscriptionId,
        currentPeriodStart: purchasedAt,
        currentPeriodEnd: expiresAt,
        ...(isTrial && {
          trialStart: purchasedAt,
          // Finding (f) — a backstop, not the authority.
          trialEnd: new Date(expiresAt.getTime() + TRIAL_EXPIRY_BACKSTOP_MS),
        }),
        entitlementsJson: this.subscriptionsService.getDefaultEntitlements(
          product.planCode,
        ) as unknown as Prisma.InputJsonValue,
      },
    });

    const appliedAction = await this.activateNewSubscription(subscription.id, action, event);

    await this.upsertStorePurchase(event, organizationId, subscription.id, product);
    await this.entitlementService.invalidateEntitlementCache(organizationId);

    return {
      received: true,
      status: 'processed',
      detail: appliedAction === SubscriptionAction.START_TRIAL ? 'trial_started' : 'activated',
    };
  }

  /**
   * Run the create-time transition, falling back to `ACTIVATE` if `START_TRIAL`
   * is refused.
   *
   * `START_TRIAL` carries two guards that are ours, not the store's: one trial
   * per org+plan, and `plan.trialEnabled`. The store has already granted the
   * trial by the time this event arrives, so a guard failure must not 500 the
   * webhook and strand a subscriber on `provisioning` — an unreachable state
   * that grants nothing. Activating instead grants the plan the user is
   * genuinely entitled to and records why the trial record was skipped.
   */
  private async activateNewSubscription(
    subscriptionId: string,
    action: SubscriptionAction.ACTIVATE | SubscriptionAction.START_TRIAL,
    event: NormalizedStoreEvent,
  ): Promise<SubscriptionAction> {
    try {
      await this.lifecycleService.executeTransition({
        subscriptionId,
        action,
        actorType: 'system',
        reason: `Store purchase (${event.providerEventName})`,
        metadata: event.auditMetadata,
      });
      return action;
    } catch (err) {
      if (action !== SubscriptionAction.START_TRIAL) throw err;

      this.logger.warn(
        `START_TRIAL refused for subscription ${subscriptionId} (${err instanceof Error ? err.message : String(err)}) — activating instead so the store purchase is honoured`,
      );
      await this.lifecycleService.executeTransition({
        subscriptionId,
        action: SubscriptionAction.ACTIVATE,
        actorType: 'system',
        reason: 'Store trial purchase; local trial guard refused, honoured as active',
        metadata: event.auditMetadata,
      });
      return SubscriptionAction.ACTIVATE;
    }
  }

  // ---- transition (§4.1 rows 5–27) ----

  private async runTransition(
    action: SubscriptionAction,
    event: NormalizedStoreEvent,
    subscription: StoreSubscriptionRow,
  ): Promise<StoreEventOutcome> {
    // ORDER MATTERS. The period must be written BEFORE the transition:
    // UNDO_CANCEL guards on `currentPeriodEnd` not having passed, so running it
    // against a stale period end would throw on exactly the renewal that is
    // supposed to rescue the subscription. RENEW's SCHEDULE_EVENT side effect
    // reads the same column.
    //
    // D8's one hard requirement lives here too: the RENEWAL handler must write
    // `planCode` from STORE_PRODUCT_MAP rather than carrying forward whatever
    // the row already had, or an `edu` subscriber who upgraded to `pro` stays on
    // `edu` indefinitely.
    if (event.type === 'purchase.renewed' || event.type === 'purchase.extended') {
      await this.applyPeriodFromEvent(subscription.id, event, { applyProduct: true });
    }

    await this.lifecycleService.executeTransition({
      subscriptionId: subscription.id,
      action,
      actorType: 'system',
      reason: `Store event ${event.providerEventName}`,
      metadata: event.auditMetadata,
    });

    const isRefund = event.cancelReason === 'CUSTOMER_SUPPORT';

    if (action === SubscriptionAction.CANCEL_IMMEDIATELY) {
      // Mirrors handlePlanDeactivated exactly.
      await this.createFreeFallback(subscription.organizationId);
      await this.cancelPendingRenewalReminders(subscription.id);
      await this.markPurchaseStatus(event, isRefund ? 'refunded' : 'expired');
    } else if (action === SubscriptionAction.EXPIRE_TRIAL) {
      await this.createFreeFallback(subscription.organizationId);
      await this.cancelPendingRenewalReminders(subscription.id);
      await this.markPurchaseStatus(event, 'expired');
    } else if (event.type === 'purchase.refund_reversed') {
      // §8 — the clawback is reversed: the row is live again.
      await this.markPurchaseStatus(event, 'active');
    } else if (event.type === 'purchase.renewed') {
      // A renewal is a NEW store transaction against the same original
      // transaction id, so it gets its own store_purchases row.
      const product = resolveStoreProduct(event.productId);
      if (product) {
        await this.upsertStorePurchase(
          event,
          subscription.organizationId,
          subscription.id,
          product,
        );
      }
    }

    // NON-NEGOTIABLE. Without this a revoked org keeps paid entitlements for up
    // to the 120s cache TTL, and a restored one is refused for the same window.
    await this.entitlementService.invalidateEntitlementCache(subscription.organizationId);

    return { received: true, status: 'processed', detail: action };
  }

  // ---- §6.1: web subscription exists, the store purchase wins ----

  /**
   * The store charge is irreversible by us: we cannot cancel or refund an Apple
   * or Google subscription server-side. The web charge is ours and we can stop
   * it. Cancelling the reversible one is the only choice that does not require
   * the user to file a store refund request.
   *
   * The unused remainder of the web subscription is left to support on purpose.
   * These cases are rare and an automated refund path is a larger attack
   * surface than a support queue.
   */
  private async enforceDoubleBillingGuard(
    organizationId: string,
    event: NormalizedStoreEvent,
  ): Promise<void> {
    const webSub = await this.prisma.subscription.findFirst({
      where: {
        organizationId,
        status: { in: ACCESSIBLE_STATE_VALUES },
        provider: { in: [...PAYMENT_PROVIDERS] },
        planCode: { not: 'free' },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!webSub) return;

    this.logger.warn(
      `Double subscription detected for org ${organizationId}: web subscription ${webSub.id} (${webSub.provider}) alongside a store purchase`,
    );

    try {
      await this.lifecycleService.executeTransition({
        subscriptionId: webSub.id,
        action: SubscriptionAction.REQUEST_CANCEL,
        actorType: 'system',
        reason: 'Store purchase honoured; web subscription stops renewing at period end (§6.1)',
        metadata: { rcEventId: event.eventId, store: event.store },
      });
    } catch (err) {
      // REQUEST_CANCEL is legal only from ACTIVE. From past_due, trialing or an
      // already-cancelling row there is nothing to do — and this must NEVER
      // fail the store purchase, which is already paid for.
      this.logger.warn(
        `Could not REQUEST_CANCEL web subscription ${webSub.id} (${webSub.status}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await this.auditService.log({
      organizationId,
      actorType: 'system',
      action: 'billing.iap.double_subscription_detected',
      entityType: 'subscription',
      entityId: webSub.id,
      metadata: {
        webSubscriptionId: webSub.id,
        webProvider: webSub.provider,
        webStatus: webSub.status,
        ...event.auditMetadata,
      },
    });
  }

  // ---- §5.2: multi-member orgs ----

  private async flagMultiMemberGrant(
    organizationId: string,
    event: NormalizedStoreEvent,
    product: StoreProductDefinition,
  ): Promise<void> {
    const memberCount = await this.prisma.organizationMember.count({
      where: { organizationId, status: 'active' },
    });
    if (memberCount <= 1) return;

    this.logger.warn(
      `Store purchase grants ${product.planCode} to org ${organizationId} with ${memberCount} active members`,
    );
    await this.auditService.log({
      organizationId,
      actorType: 'system',
      action: 'billing.iap.multi_member_grant',
      entityType: 'organization',
      entityId: organizationId,
      metadata: { memberCount, planCode: product.planCode, ...event.auditMetadata },
    });
  }

  // ---- §5.3: TRANSFER ----

  /**
   * Revoke on the losing org, grant on the gaining one.
   *
   * `providerSubscriptionId` is globally `@unique`, so the losing row's value
   * must be cleared IN THE SAME TRANSACTION as the gaining row's write or the
   * write violates the constraint. The design calls this the single most likely
   * implementation bug in the whole thing, which is why the clearing and the
   * claiming are one `$transaction` below and why there is a test for it.
   */
  private async handleTransfer(event: NormalizedStoreEvent): Promise<StoreEventOutcome> {
    const fromOrgId = await this.resolveOrganizationId(event.transferredFrom[0]);
    const toOrgId = await this.resolveOrganizationId(
      event.transferredTo[0] ?? event.appUserId,
    );

    if (!toOrgId) {
      this.logger.warn(`TRANSFER ${event.eventId}: gaining org unresolvable — recorded only`);
      return { received: true, status: 'unresolved_org' };
    }

    const originalTransactionId = event.originalTransactionId;
    const losingSub = fromOrgId ? await this.findStoreSubscription(fromOrgId) : null;

    // 1. Losing org: revoke.
    if (losingSub && fromOrgId) {
      try {
        await this.lifecycleService.executeTransition({
          subscriptionId: losingSub.id,
          action: SubscriptionAction.CANCEL_IMMEDIATELY,
          actorType: 'system',
          reason: 'Store entitlement transferred to another account (§5.3)',
          metadata: event.auditMetadata,
        });
        await this.createFreeFallback(fromOrgId);
        await this.cancelPendingRenewalReminders(losingSub.id);
      } catch (err) {
        this.logger.warn(
          `TRANSFER: could not revoke losing subscription ${losingSub.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      await this.entitlementService.invalidateEntitlementCache(fromOrgId);
      await this.auditService.log({
        organizationId: fromOrgId,
        actorType: 'system',
        action: 'billing.iap.transfer_out',
        entityType: 'subscription',
        entityId: losingSub.id,
        metadata: event.auditMetadata,
      });
    }

    // 2. Gaining org: create or reactivate, claiming the same
    //    providerSubscriptionId in one transaction with the clearing.
    const gainingSub = await this.findStoreSubscription(toOrgId);
    const product = resolveStoreProduct(event.productId);
    const expiresAt = event.expiresAt ?? null;

    await this.prisma.$transaction(async (tx) => {
      if (originalTransactionId) {
        // Clear the id from EVERY row that is not the gaining row. This is the
        // step whose omission makes the insert below fail on the unique index.
        await tx.subscription.updateMany({
          where: {
            providerSubscriptionId: originalTransactionId,
            ...(gainingSub && { id: { not: gainingSub.id } }),
          },
          data: { providerSubscriptionId: null },
        });
      }

      if (gainingSub) {
        await tx.subscription.update({
          where: { id: gainingSub.id },
          data: {
            providerSubscriptionId: originalTransactionId,
            providerCustomerId: event.appUserId,
            ...(expiresAt && { currentPeriodEnd: expiresAt }),
            ...(product && {
              planCode: product.planCode,
              billingPeriod: product.billingPeriod,
            }),
          },
        });
      } else if (product && event.store) {
        await tx.subscription.create({
          data: {
            organizationId: toOrgId,
            planCode: product.planCode,
            status: SubscriptionState.PROVISIONING,
            billingPeriod: product.billingPeriod,
            seats: 1,
            provider: event.store,
            providerCustomerId: event.appUserId,
            providerSubscriptionId: originalTransactionId,
            currentPeriodStart: event.purchasedAt ?? new Date(),
            currentPeriodEnd:
              expiresAt ?? new Date(Date.now() + DEFAULT_PERIOD_MS),
            entitlementsJson: this.subscriptionsService.getDefaultEntitlements(
              product.planCode,
            ) as unknown as Prisma.InputJsonValue,
          },
        });
      }
    });

    // 3. Move the gaining row into an accessible state.
    const claimed = await this.findStoreSubscription(toOrgId);
    if (claimed) {
      const action =
        claimed.status === SubscriptionState.PROVISIONING ||
        claimed.status === SubscriptionState.EXPIRED ||
        claimed.status === SubscriptionState.TRIAL_EXPIRED
          ? SubscriptionAction.ACTIVATE
          : claimed.status === SubscriptionState.CANCELLED
            ? SubscriptionAction.REACTIVATE
            : null;
      if (action) {
        await this.lifecycleService.executeTransition({
          subscriptionId: claimed.id,
          action,
          actorType: 'system',
          reason: 'Store entitlement transferred in (§5.3)',
          metadata: event.auditMetadata,
        });
      }
    }

    // 4. Mark the store_purchases row transferred.
    if (originalTransactionId && event.store) {
      await this.prisma.storePurchase.updateMany({
        where: { store: event.store, rcOriginalTransactionId: originalTransactionId },
        data: {
          status: 'transferred',
          transferredAt: new Date(),
          transferredToOrgId: toOrgId,
        },
      });
    }

    // 5. Audit on BOTH orgs — the transfer-out audit is written above.
    await this.entitlementService.invalidateEntitlementCache(toOrgId);
    await this.auditService.log({
      organizationId: toOrgId,
      actorType: 'system',
      action: 'billing.iap.transfer_in',
      entityType: 'organization',
      entityId: toOrgId,
      metadata: { fromOrganizationId: fromOrgId, ...event.auditMetadata },
    });

    return { received: true, status: 'processed', detail: 'transferred' };
  }

  // ======================================================================
  // §9 — reconciliation by server-side pull
  // ======================================================================

  /**
   * Pull the conduit's own view of this org and reconcile drift.
   *
   * Called after `restorePurchases()` resolves (D12), by the nightly job, and
   * by the admin resync. It compares only the fields the STORE owns — whether
   * an entitlement is active at all, `expiresAt`, and the product — and applies
   * the SAME §4 resolution the webhook path uses, so it can never invent a
   * state the webhook path could not have produced.
   */
  async syncFromStore(organizationId: string): Promise<StoreEventOutcome> {
    // The conduit credential gates the ONLY outbound call in this module, and
    // `fetchSubscriberSnapshot` throws a bare Error when it is absent. Unlike
    // the nightly sweep — which is ours and can simply not run — this method is
    // reachable at POST /store/sync by any authenticated user, so an
    // unconfigured deployment answers every call with a 500. Refuse before the
    // pull instead, and say why.
    //
    // Mirrors the guard in store-reconciliation.scheduler.ts. If that one moves,
    // move this one.
    if (!this.config.get<string>('REVENUECAT_API_KEY')) {
      this.logger.warn(
        `Store sync requested for org ${organizationId} with no conduit credential configured — nothing to reconcile against`,
      );
      return { received: true, status: 'noop', detail: 'conduit_unconfigured' };
    }

    const snapshot = await this.storeProvider.fetchSubscriberSnapshot(organizationId);
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
    const wantedEnvironment = isProduction ? 'production' : 'sandbox';

    // D10 applies to the pull path too, or a sandbox tester's restore would
    // grant production entitlement through the back door.
    const active = snapshot.entitlements.find(
      (entitlement) =>
        entitlement.environment === wantedEnvironment &&
        resolveStoreProduct(entitlement.productId) !== null &&
        (entitlement.expiresAt === null || entitlement.expiresAt.getTime() > Date.now()),
    );

    const subscription = await this.findStoreSubscription(organizationId);
    const currentState = subscription ? (subscription.status as SubscriptionState) : null;
    const isAccessible =
      currentState !== null && ACCESSIBLE_STATE_VALUES.includes(currentState);

    // The store says "entitled" and we do not agree → replay the purchase.
    if (active && !isAccessible) {
      const synthetic = this.syntheticEvent(organizationId, {
        type: 'purchase.initial',
        productId: active.productId,
        store: active.store,
        expiresAt: active.expiresAt,
        periodType: active.periodType === 'TRIAL' ? 'TRIAL' : 'NORMAL',
      });
      const resolution = resolveStoreEvent({
        type: synthetic.type,
        currentState,
        periodType: synthetic.periodType,
        cancelReason: null,
      });
      await this.logDrift(organizationId, 'granting', active.productId, currentState);
      return this.applyResolution(resolution, synthetic, organizationId, subscription);
    }

    // The store says "not entitled" and we still grant → replay the expiry.
    if (!active && isAccessible && subscription) {
      const synthetic = this.syntheticEvent(organizationId, {
        type: 'purchase.expired',
        productId: subscription.planCode,
        store: isStoreProviderSlug(subscription.provider) ? subscription.provider : null,
        expiresAt: subscription.currentPeriodEnd,
        periodType: 'NORMAL',
      });
      const resolution = resolveStoreEvent({
        type: 'purchase.expired',
        currentState,
        periodType: null,
        cancelReason: null,
      });
      await this.logDrift(organizationId, 'revoking', subscription.planCode, currentState);
      return this.applyResolution(resolution, synthetic, organizationId, subscription);
    }

    // Both agree on entitlement; the period may still have moved.
    if (active && subscription && active.expiresAt) {
      const localEnd = subscription.currentPeriodEnd?.getTime() ?? 0;
      if (active.expiresAt.getTime() !== localEnd) {
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { currentPeriodEnd: active.expiresAt },
        });
        await this.entitlementService.invalidateEntitlementCache(organizationId);
        await this.logDrift(organizationId, 'period', active.productId, currentState);
        return { received: true, status: 'processed', detail: 'period_reconciled' };
      }
    }

    return { received: true, status: 'noop', detail: 'in_sync' };
  }

  /**
   * The nightly sweep. Every org holding a store subscription in a non-terminal
   * state gets pulled, so a webhook lost to a three-hour outage self-heals
   * rather than stranding a paying user on `free`. Drift is measured rather
   * than assumed absent.
   */
  async reconcileAllStoreSubscriptions(): Promise<{ checked: number; corrected: number }> {
    const rows = await this.prisma.subscription.findMany({
      where: {
        provider: { in: [...STORE_PROVIDERS] },
        status: { notIn: [SubscriptionState.TERMINATED] },
      },
      select: { organizationId: true },
      distinct: ['organizationId'],
    });

    let corrected = 0;
    for (const { organizationId } of rows) {
      try {
        const outcome = await this.syncFromStore(organizationId);
        if (outcome.status === 'processed') corrected += 1;
      } catch (err) {
        // One org's failure must not end the sweep.
        this.logger.warn(
          `Store reconciliation failed for org ${organizationId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { checked: rows.length, corrected };
  }

  private async logDrift(
    organizationId: string,
    direction: string,
    productId: string,
    localState: SubscriptionState | null,
  ): Promise<void> {
    await this.auditService.log({
      organizationId,
      actorType: 'system',
      action: 'billing.iap.reconciliation_drift',
      entityType: 'organization',
      entityId: organizationId,
      metadata: { direction, productId, localState },
    });
  }

  /**
   * A snapshot entry dressed as an event, so the pull path runs through the
   * same §4 resolver as the webhook path instead of growing a second, subtly
   * different set of rules.
   */
  private syntheticEvent(
    organizationId: string,
    fields: Pick<NormalizedStoreEvent, 'type' | 'productId' | 'store' | 'expiresAt' | 'periodType'>,
  ): NormalizedStoreEvent {
    return {
      conduit: this.storeProvider.slug,
      eventId: `sync:${organizationId}:${Date.now()}`,
      providerEventName: 'RECONCILIATION',
      type: fields.type,
      store: fields.store,
      environment: this.config.get<string>('NODE_ENV') === 'production' ? 'production' : 'sandbox',
      appUserId: organizationId,
      aliases: [],
      productId: fields.productId,
      entitlementIds: [],
      periodType: fields.periodType,
      transactionId: null,
      originalTransactionId: null,
      storeTransactionId: null,
      purchasedAt: new Date(),
      expiresAt: fields.expiresAt,
      cancelReason: null,
      expirationReason: null,
      transferredFrom: [],
      transferredTo: [],
      auditMetadata: { source: 'reconciliation', productId: fields.productId },
    };
  }

  // ======================================================================
  // Purchase intent (§5.2 / §6.1)
  // ======================================================================

  /**
   * Called by the client BEFORE it presents the store sheet, so the sheet never
   * opens on an org that must not buy.
   *
   * This is the skippable half of the double-billing rule — an old client can
   * ignore it. That is why `INITIAL_PURCHASE` carries its own guard (§6.1) and
   * honours the purchase rather than refusing it.
   */
  async createPurchaseIntent(
    organizationId: string,
    userId: string,
  ): Promise<PurchaseIntentResult> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, billingOwnerUserId: true },
    });
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    // Guard 1 (§5.2). An IAP is charged to ONE person's store account and is
    // refundable only by them, but it grants the whole tenant. A non-owner
    // buying for an org they can be removed from tomorrow is a support ticket
    // with no clean resolution.
    if (organization.billingOwnerUserId !== userId) {
      throw new ForbiddenException({
        code: 'not_billing_owner',
        message: 'Only the billing owner can start a store purchase.',
      });
    }

    // Guard 2 (§5.2). Both sellable plans are single-seat in the plan seed, so
    // a multi-member org on either is a state web checkout would not have sold.
    // `edu` makes this stricter, not looser: a multi-member org buying the
    // discounted tier is the cheapest way to put several working lawyers on a
    // plan priced for one student.
    const memberCount = await this.prisma.organizationMember.count({
      where: { organizationId, status: 'active' },
    });
    if (memberCount > 1) {
      throw new ConflictException({
        code: 'multi_member_org',
        message: 'Organizations with more than one member subscribe through the web.',
      });
    }

    // §6.1 — the enforceable half of the double-billing rule.
    const webSub = await this.prisma.subscription.findFirst({
      where: {
        organizationId,
        status: { in: ACCESSIBLE_STATE_VALUES },
        provider: { in: [...PAYMENT_PROVIDERS] },
        planCode: { not: 'free' },
      },
    });
    if (webSub) {
      throw new ConflictException({
        code: 'already_subscribed_elsewhere',
        message: 'This account already has an active subscription.',
      });
    }

    return {
      // D11 — the client calls `logIn(organizationId)`, on session start and on
      // any org switch, never on user login alone.
      appUserId: organizationId,
      products: STORE_PRODUCT_IDS.map((productId) => ({
        productId,
        ...STORE_PRODUCT_MAP[productId],
      })),
    };
  }

  // ======================================================================
  // Persistence helpers
  // ======================================================================

  /**
   * Write the receipt row, letting the UNIQUE index on `rc_event_id` decide
   * whether this is new.
   *
   * The insert is attempted FIRST rather than guarded by a read: the index is
   * then the thing that enforces idempotency, including against two concurrent
   * deliveries of the same event, which a read-then-write would let through.
   *
   * A conflicting row with `processed_at IS NULL` is NOT a duplicate — it is a
   * previous attempt that failed. Treating it as one would silently drop the
   * event the conduit is retrying precisely because we asked it to.
   */
  private async recordWebhookEvent(
    event: NormalizedStoreEvent,
    organizationId: string | null,
  ): Promise<{ id: string; duplicate: boolean }> {
    const data = {
      rcEventId: event.eventId,
      conduit: event.conduit,
      eventType: event.providerEventName,
      store: event.store,
      environment: event.environment,
      appUserId: event.appUserId,
      organizationId,
      payloadJson: event.auditMetadata as Prisma.InputJsonValue,
    };

    try {
      const created = await this.prisma.storeWebhookEvent.create({ data });
      return { id: created.id, duplicate: false };
    } catch (err) {
      if (
        !(err instanceof Prisma.PrismaClientKnownRequestError) ||
        err.code !== 'P2002'
      ) {
        throw err;
      }
      const existing = await this.prisma.storeWebhookEvent.findUnique({
        where: { rcEventId: event.eventId },
        select: { id: true, processedAt: true },
      });
      if (!existing) throw err;
      return { id: existing.id, duplicate: existing.processedAt !== null };
    }
  }

  private async markProcessed(id: string, outcome: StoreEventOutcome): Promise<void> {
    await this.prisma.storeWebhookEvent.update({
      where: { id },
      data: { processedAt: new Date(), processingError: null },
    });
    this.logger.log(`Store webhook event ${id} → ${outcome.status}${outcome.detail ? ` (${outcome.detail})` : ''}`);
  }

  private async markFailed(id: string, err: unknown): Promise<void> {
    try {
      await this.prisma.storeWebhookEvent.update({
        where: { id },
        data: { processingError: err instanceof Error ? err.message : String(err) },
      });
    } catch (updateErr) {
      this.logger.error(`Could not record processing error for event ${id}`, updateErr);
    }
  }

  /**
   * One row per store transaction, keyed by `(store, rc_transaction_id)`.
   *
   * `planCode` and `billingPeriod` are denormalised from STORE_PRODUCT_MAP at
   * write time so a later change to the map cannot rewrite history.
   */
  private async upsertStorePurchase(
    event: NormalizedStoreEvent,
    organizationId: string,
    subscriptionId: string,
    product: StoreProductDefinition,
  ): Promise<void> {
    const store = event.store;
    const transactionId = event.transactionId ?? event.originalTransactionId;
    if (!store || !transactionId) return;

    const purchasedAt = event.purchasedAt ?? new Date();
    const common = {
      organizationId,
      subscriptionId,
      environment: event.environment,
      appUserId: event.appUserId,
      productId: event.productId ?? '',
      entitlementIds: event.entitlementIds as unknown as Prisma.InputJsonValue,
      planCode: product.planCode,
      billingPeriod: product.billingPeriod,
      rcOriginalTransactionId: event.originalTransactionId ?? transactionId,
      storeTransactionId: event.storeTransactionId,
      periodType: event.periodType ?? 'NORMAL',
      purchasedAt,
      expiresAt: event.expiresAt,
    };

    await this.prisma.storePurchase.upsert({
      where: { store_rcTransactionId: { store, rcTransactionId: transactionId } },
      create: { ...common, store, rcTransactionId: transactionId, status: 'active' },
      update: common,
    });
  }

  /** D8 — record the pending product; the next RENEWAL applies it. */
  private async recordPendingProduct(
    event: NormalizedStoreEvent,
    organizationId: string,
  ): Promise<void> {
    const purchase = await this.latestPurchase(organizationId, event);
    if (!purchase) return;

    await this.mergePurchaseMetadata(purchase.id, {
      pending_product_id: event.productId,
      pending_product_recorded_at: new Date().toISOString(),
    });
  }

  /** §4.2 (a) — the state is unchanged, but auto-renew really did go off. */
  private async markAutoRenewOff(
    event: NormalizedStoreEvent,
    organizationId: string,
  ): Promise<void> {
    const purchase = await this.latestPurchase(organizationId, event);
    if (!purchase) return;

    await this.mergePurchaseMetadata(purchase.id, {
      auto_renew: false,
      auto_renew_off_at: new Date().toISOString(),
    });
  }

  /**
   * Merge `patch` into `store_purchases.metadata_json` IN THE DATABASE.
   *
   * Postgres `||` on two jsonb values does the merge server-side, in one
   * statement, so concurrent writers cannot lose each other's keys. The obvious
   * alternative — read the row, spread its `metadataJson` in JS, write the
   * result back — is a read-modify-write: two events arriving together each
   * read the same `before` and the second write erases the first's key. These
   * events genuinely do arrive together (a PRODUCT_CHANGE and a CANCELLATION on
   * the same subscription both land here), and losing `auto_renew` or
   * `pending_product_id` is silent — the row still looks well-formed.
   *
   * `updated_at` is set explicitly because Prisma's `@updatedAt` is applied by
   * the query engine, not by the database, so raw SQL bypasses it entirely.
   *
   * The tagged template BINDS both values as parameters — there is no string
   * interpolation into this SQL, and there must never be.
   */
  private async mergePurchaseMetadata(
    purchaseId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE store_purchases
      SET metadata_json = metadata_json || ${JSON.stringify(patch)}::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${purchaseId}::uuid
    `;
  }

  private async markPurchaseStatus(
    event: NormalizedStoreEvent,
    status: 'active' | 'expired' | 'refunded',
  ): Promise<void> {
    const original = event.originalTransactionId;
    if (!event.store || !original) return;

    await this.prisma.storePurchase.updateMany({
      where: { store: event.store, rcOriginalTransactionId: original },
      data: {
        status,
        // §8 — the clawback record, and its reversal. THREE-WAY, not two:
        //
        //   'refunded' → stamp it.
        //   'active'   → clear it. This is REFUND_REVERSED and nothing else,
        //                so clearing is the whole point.
        //   'expired'  → LEAVE IT ALONE.
        //
        // That last case is why this is not a ternary. A refunded subscription
        // reaches its period end like any other and draws an EXPIRATION, so
        // `refunded ? now : null` quietly erased `refunded_at` on the ordinary
        // follow-up event — destroying the exact field the audit trail is read
        // for months later, while `status` still said 'refunded'.
        ...(status === 'refunded' && { refundedAt: new Date() }),
        ...(status === 'active' && { refundedAt: null }),
      },
    });
  }

  /**
   * Resolve WHICH store_purchases row a metadata patch belongs to.
   *
   * Selects the id and nothing else, deliberately: `mergePurchaseMetadata`
   * merges in the database, so the current `metadata_json` is never read into
   * this process. Selecting it would invite someone to spread it again and
   * quietly reintroduce the lost-update this exists to avoid.
   */
  private async latestPurchase(organizationId: string, event: NormalizedStoreEvent) {
    return this.prisma.storePurchase.findFirst({
      where: {
        organizationId,
        ...(event.originalTransactionId && {
          rcOriginalTransactionId: event.originalTransactionId,
        }),
      },
      select: { id: true },
      orderBy: [{ purchasedAt: 'desc' }, { id: 'desc' }],
    });
  }

  /**
   * Write the period the STORE reports.
   *
   * `applyProduct` also rewrites `planCode` / `billingPeriod` from
   * STORE_PRODUCT_MAP, which is the one thing D8's deferral requires of the
   * RENEWAL handler: a handler that only updated `billing_period` would leave
   * an upgraded subscriber on `edu` indefinitely.
   */
  private async applyPeriodFromEvent(
    subscriptionId: string,
    event: NormalizedStoreEvent,
    options: { applyProduct?: boolean } = {},
  ): Promise<void> {
    const product = options.applyProduct ? resolveStoreProduct(event.productId) : null;

    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        ...(event.expiresAt && { currentPeriodEnd: event.expiresAt }),
        ...(event.purchasedAt && { currentPeriodStart: event.purchasedAt }),
        ...(product && { planCode: product.planCode, billingPeriod: product.billingPeriod }),
      },
    });

    if (event.store && event.originalTransactionId && event.expiresAt) {
      await this.prisma.storePurchase.updateMany({
        where: {
          store: event.store,
          rcOriginalTransactionId: event.originalTransactionId,
          status: 'active',
        },
        data: { expiresAt: event.expiresAt },
      });
    }
  }

  // ======================================================================
  // Lookups
  // ======================================================================

  /**
   * D11 — the App User ID IS the organization id, so this is a uuid check and a
   * single lookup rather than a `user → org` resolution on every webhook.
   *
   * Returns `null` (never throws) for an id we cannot resolve: that fact is
   * recorded on the webhook-event row rather than making the conduit retry
   * something that will never resolve.
   */
  private async resolveOrganizationId(appUserId: string | undefined): Promise<string | null> {
    if (!appUserId || !UUID_RE.test(appUserId)) return null;
    const org = await this.prisma.organization.findUnique({
      where: { id: appUserId },
      select: { id: true },
    });
    return org?.id ?? null;
  }

  /** The org's most recent STORE-backed subscription, whatever state it is in. */
  private async findStoreSubscription(
    organizationId: string,
  ): Promise<StoreSubscriptionRow | null> {
    return this.prisma.subscription.findFirst({
      where: { organizationId, provider: { in: [...STORE_PROVIDERS] } },
      select: {
        id: true,
        organizationId: true,
        planCode: true,
        status: true,
        provider: true,
        providerSubscriptionId: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  /**
   * `Subscription.providerSubscriptionId` is globally `@unique`. A store can
   * re-issue an original transaction id to a different App User ID (the §5.3
   * restore-transfer case), so claiming one means releasing it from whatever
   * row holds it now — otherwise the insert 500s the webhook.
   */
  private async claimProviderSubscriptionId(
    originalTransactionId: string | null,
    organizationId: string,
  ): Promise<string | null> {
    if (!originalTransactionId) return null;

    const holder = await this.prisma.subscription.findUnique({
      where: { providerSubscriptionId: originalTransactionId },
      select: { id: true, organizationId: true },
    });
    if (holder && holder.organizationId !== organizationId) {
      this.logger.warn(
        `Releasing provider subscription id from org ${holder.organizationId} to ${organizationId}`,
      );
      await this.prisma.subscription.update({
        where: { id: holder.id },
        data: { providerSubscriptionId: null },
      });
    }
    return originalTransactionId;
  }

  // ======================================================================
  // Mirrors of BillingService's private helpers
  //
  // Reimplemented rather than imported: BillingModule binds PAYMENT_PROVIDER by
  // an exclusive-or factory (D1), and this module must not acquire a dependency
  // on the gateway that happens to be configured. Both are small and their
  // behaviour must stay identical to billing.service.ts — if that file's copy
  // changes, change this one.
  // ======================================================================

  /**
   * NO-OP when the org still holds any subscription in an accessible state: the
   * fallback row is dated now, so it would otherwise win the `createdAt desc`
   * ordering in `getActiveSubscription` and demote a live paid, trialing or
   * complimentary subscription to free.
   */
  private async createFreeFallback(organizationId: string): Promise<void> {
    if (await this.subscriptionsService.hasAccessibleSubscription(organizationId)) {
      this.logger.log(
        `Free-tier fallback skipped for org ${organizationId}: an accessible subscription already exists`,
      );
      return;
    }
    await this.prisma.subscription.create({
      data: {
        organizationId,
        planCode: 'free',
        status: SubscriptionState.ACTIVE,
        seats: 1,
        entitlementsJson: this.subscriptionsService.getDefaultEntitlements(
          'free',
        ) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** No further charges will occur — drop any pending renewal reminder. Never throws. */
  private async cancelPendingRenewalReminders(subscriptionId: string): Promise<void> {
    try {
      await this.prisma.subscriptionLifecycleEvent.updateMany({
        where: { subscriptionId, eventType: 'renewal_reminder', status: 'pending' },
        data: { status: 'cancelled' },
      });
    } catch (err) {
      this.logger.warn(
        `Could not cancel pending renewal reminders for subscription ${subscriptionId}: ${err}`,
      );
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
