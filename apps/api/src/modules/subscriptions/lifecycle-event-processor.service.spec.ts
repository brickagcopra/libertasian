import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { LifecycleEventProcessorService } from './lifecycle-event-processor.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionAction } from './subscription-state-machine';

describe('LifecycleEventProcessorService', () => {
  let service: LifecycleEventProcessorService;
  let prisma: {
    subscriptionLifecycleEvent: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
    subscription: { create: jest.Mock };
  };
  let lifecycleService: jest.Mocked<SubscriptionLifecycleService>;

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

  beforeEach(async () => {
    prisma = {
      subscriptionLifecycleEvent: {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      subscription: { create: jest.fn() },
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
          useValue: { getDefaultEntitlements: jest.fn().mockReturnValue({}) },
        },
      ],
    }).compile();

    service = module.get(LifecycleEventProcessorService);
    lifecycleService = module.get(SubscriptionLifecycleService);
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
});
