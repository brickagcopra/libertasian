import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LifecycleEventProcessorService } from './lifecycle-event-processor.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionAction } from './subscription-state-machine';

describe('LifecycleEventProcessorService', () => {
  let service: LifecycleEventProcessorService;
  let prisma: {
    subscriptionLifecycleEvent: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
    subscription: { create: jest.Mock; findUnique: jest.Mock };
    organization: { findUnique: jest.Mock };
    plan: { findUnique: jest.Mock };
    planPrice: { findFirst: jest.Mock };
    payment: { findFirst: jest.Mock };
    paymentMethod: { findFirst: jest.Mock };
  };
  let lifecycleService: jest.Mocked<SubscriptionLifecycleService>;
  let notificationsService: { sendRenewalReminder: jest.Mock };
  let subscriptionsService: { hasAccessibleSubscription: jest.Mock };

  const cancellationEndEvent = () => ({
    id: 'evt-cancel-1',
    eventType: 'cancellation_end',
    attempts: 0,
    maxAttempts: 3,
    subscription: {
      id: 'sub-1',
      status: 'cancelling',
      organizationId: 'org-1',
      planCode: 'pro',
      xenditSubscriptionId: 'repl_1',
    },
  });

  const renewalEvent = (xenditSubscriptionId: string | null) => ({
    id: 'evt-1',
    eventType: 'renewal',
    attempts: 0,
    maxAttempts: 3,
    subscription: {
      id: 'sub-1',
      status: 'active',
      organizationId: 'org-1',
      planCode: 'pro',
      xenditSubscriptionId,
    },
  });

  // Must be in the future — the processor no-ops reminders whose charge date
  // has already passed. Relative so the suite never goes stale.
  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const reminderEvent = () => ({
    id: 'evt-reminder-1',
    eventType: 'renewal_reminder',
    attempts: 0,
    maxAttempts: 3,
    metadataJson: { periodEnd: periodEnd.toISOString() },
    subscription: {
      id: 'sub-1',
      status: 'active',
      organizationId: 'org-1',
      planCode: 'pro',
      xenditSubscriptionId: 'repl_1',
    },
  });

  /** Fresh subscription row as re-read by the reminder path. */
  const eligibleSub = {
    id: 'sub-1',
    organizationId: 'org-1',
    planCode: 'pro',
    planId: 'plan-1',
    status: 'active',
    billingPeriod: 'monthly',
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    xenditSubscriptionId: 'repl_1',
  };

  beforeEach(async () => {
    prisma = {
      subscriptionLifecycleEvent: {
        findMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      subscription: { create: jest.fn(), findUnique: jest.fn() },
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          billingOwner: { email: 'owner@example.com', fullName: 'Owner' },
        }),
      },
      plan: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'plan-1',
          code: 'pro',
          displayName: 'Pro',
          prices: [{ amount: 199900 }],
        }),
      },
      planPrice: { findFirst: jest.fn() },
      payment: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentMethod: {
        findFirst: jest.fn().mockResolvedValue({ type: 'card', brand: 'Visa', last4: '4242' }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LifecycleEventProcessorService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: SubscriptionLifecycleService,
          useValue: { executeTransition: jest.fn().mockResolvedValue({ success: true }) },
        },
        {
          provide: SubscriptionsService,
          useValue: {
            getDefaultEntitlements: jest.fn().mockReturnValue({}),
            hasAccessibleSubscription: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: NotificationsService,
          useValue: { sendRenewalReminder: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(LifecycleEventProcessorService);
    lifecycleService = module.get(SubscriptionLifecycleService);
    notificationsService = module.get(NotificationsService);
    subscriptionsService = module.get(SubscriptionsService);
  });

  // ---- cancellation_end (CANCELLING -> CANCELLED at currentPeriodEnd) ----

  describe('cancellation_end events', () => {
    beforeEach(() => {
      prisma.subscriptionLifecycleEvent.findMany.mockResolvedValue([cancellationEndEvent()]);
    });

    it('cancels the subscription and creates the free fallback', async () => {
      await service.processDueEvents();

      expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: 'sub-1',
          action: SubscriptionAction.CANCEL_IMMEDIATELY,
        }),
      );
      expect(prisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ planCode: 'free' }) }),
      );
    });

    it('does NOT create the free fallback when an accessible subscription remains', async () => {
      subscriptionsService.hasAccessibleSubscription.mockResolvedValue(true);

      await service.processDueEvents();

      expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({ action: SubscriptionAction.CANCEL_IMMEDIATELY }),
      );
      expect(prisma.subscription.create).not.toHaveBeenCalled();
      expect(prisma.subscriptionLifecycleEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'evt-cancel-1' },
          data: expect.objectContaining({ status: 'completed' }),
        }),
      );
    });
  });

  // DOUBLE-RENEWAL GUARD: the critical money-safety test.
  it('NO-OPs an internal renewal event for a Xendit-backed subscription (no double-advance)', async () => {
    prisma.subscriptionLifecycleEvent.findMany.mockResolvedValue([renewalEvent('repl_1')]);

    await service.processDueEvents();

    // The renewal must NOT fire RENEW — Xendit drives the cycle.
    expect(lifecycleService.executeTransition).not.toHaveBeenCalled();
    // The event is closed out as completed (no-op), not left pending.
    expect(prisma.subscriptionLifecycleEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'evt-1' },
        data: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });

  it('still processes an internal renewal for a NON-Xendit subscription', async () => {
    prisma.subscriptionLifecycleEvent.findMany.mockResolvedValue([renewalEvent(null)]);

    await service.processDueEvents();

    expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: 'sub-1', action: SubscriptionAction.RENEW }),
    );
  });

  // ---- renewal_reminder (T-3d upcoming-charge email) ----

  describe('renewal_reminder events', () => {
    const expectCompletedNoSend = () => {
      expect(notificationsService.sendRenewalReminder).not.toHaveBeenCalled();
      expect(prisma.subscriptionLifecycleEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'evt-reminder-1' },
          data: expect.objectContaining({ status: 'completed' }),
        }),
      );
    };

    beforeEach(() => {
      prisma.subscriptionLifecycleEvent.findMany.mockResolvedValue([reminderEvent()]);
    });

    it('sends the reminder for an active, Xendit-backed, non-cancelling subscription and completes the event', async () => {
      prisma.subscription.findUnique.mockResolvedValue(eligibleSub);

      await service.processDueEvents();

      expect(notificationsService.sendRenewalReminder).toHaveBeenCalledWith({
        email: 'owner@example.com',
        userName: 'Owner',
        planName: 'Pro',
        billingPeriod: 'monthly',
        amount: '1,999.00',
        chargeDate: expect.any(String),
        paymentMethod: 'Visa •••• 4242',
      });
      // No state transition — this is an email-only event.
      expect(lifecycleService.executeTransition).not.toHaveBeenCalled();
      expect(prisma.subscriptionLifecycleEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'evt-reminder-1' },
          data: expect.objectContaining({ status: 'completed' }),
        }),
      );
    });

    it('falls back to the last succeeded payment amount when the plan has no active price', async () => {
      prisma.subscription.findUnique.mockResolvedValue(eligibleSub);
      prisma.plan.findUnique.mockResolvedValue({ id: 'plan-1', displayName: 'Pro', prices: [] });
      prisma.payment.findFirst.mockResolvedValue({ amount: 99900 });

      await service.processDueEvents();

      expect(notificationsService.sendRenewalReminder).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '999.00' }),
      );
    });

    it('skips (no-op complete) when the subscription is cancelAtPeriodEnd', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ ...eligibleSub, cancelAtPeriodEnd: true });

      await service.processDueEvents();

      expectCompletedNoSend();
    });

    it('skips (no-op complete) when the subscription is no longer active', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ ...eligibleSub, status: 'past_due' });

      await service.processDueEvents();

      expectCompletedNoSend();
    });

    it('skips (no-op complete) when the subscription is not Xendit-backed', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ ...eligibleSub, xenditSubscriptionId: null });

      await service.processDueEvents();

      expectCompletedNoSend();
    });

    it('is idempotent per billing period — a reminder already completed for the same periodEnd is not re-sent', async () => {
      prisma.subscription.findUnique.mockResolvedValue(eligibleSub);
      prisma.subscriptionLifecycleEvent.findFirst.mockResolvedValue({ id: 'evt-reminder-0' });

      await service.processDueEvents();

      expect(prisma.subscriptionLifecycleEvent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            subscriptionId: 'sub-1',
            eventType: 'renewal_reminder',
            status: 'completed',
            metadataJson: { path: ['periodEnd'], equals: periodEnd.toISOString() },
          }),
        }),
      );
      expectCompletedNoSend();
    });

    it('retries (resets to pending) when the email enqueue fails, without marking completed', async () => {
      prisma.subscription.findUnique.mockResolvedValue(eligibleSub);
      notificationsService.sendRenewalReminder.mockRejectedValue(new Error('queue down'));

      await service.processDueEvents();

      expect(prisma.subscriptionLifecycleEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'evt-reminder-1' },
          data: expect.objectContaining({ status: 'pending', lastError: 'queue down' }),
        }),
      );
      expect(prisma.subscriptionLifecycleEvent.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'evt-reminder-1' },
          data: expect.objectContaining({ status: 'completed' }),
        }),
      );
    });
  });
});
