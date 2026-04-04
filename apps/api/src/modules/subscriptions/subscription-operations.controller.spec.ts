import { Test, TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionOperationsController } from './subscription-operations.controller';
import { SubscriptionOperationsService } from './subscription-operations.service';
import { SubscriptionState } from './subscription-state-machine';

describe('SubscriptionOperationsController', () => {
  let controller: SubscriptionOperationsController;
  let operationsService: jest.Mocked<SubscriptionOperationsService>;

  const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

  const mockUser = {
    sub: 'user-1',
    organizationId: 'org-1',
    email: 'test@example.com',
    role: 'owner',
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionOperationsController],
      providers: [
        {
          provide: SubscriptionOperationsService,
          useValue: {
            startTrial: jest.fn(),
            convertTrial: jest.fn(),
            upgradePlan: jest.fn(),
            downgradePlan: jest.fn(),
            pauseSubscription: jest.fn(),
            resumeSubscription: jest.fn(),
            reactivateSubscription: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue(mockGuard)
      .overrideGuard(TenantGuard).useValue(mockGuard)
      .overrideGuard(PermissionsGuard).useValue(mockGuard)
      .compile();

    controller = module.get<SubscriptionOperationsController>(SubscriptionOperationsController);
    operationsService = module.get(SubscriptionOperationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('startTrial delegates to operations service', async () => {
    const mockResult = {
      subscriptionId: 'sub-1',
      planCode: 'pro',
      trialEndsAt: new Date(),
      status: SubscriptionState.TRIALING,
    };
    (operationsService.startTrial as jest.Mock).mockResolvedValue(mockResult);

    const result = await controller.startTrial({ planCode: 'pro' } as any, mockUser);

    expect(operationsService.startTrial).toHaveBeenCalledWith('org-1', 'pro', 'user-1');
    expect(result).toEqual({ success: true, data: mockResult });
  });

  it('convertTrial delegates with subscription id', async () => {
    const mockResult = {
      subscriptionId: 'sub-1',
      planCode: 'pro',
      billingPeriod: 'monthly',
      currentPeriodEnd: new Date(),
      status: SubscriptionState.ACTIVE,
    };
    (operationsService.convertTrial as jest.Mock).mockResolvedValue(mockResult);

    const result = await controller.convertTrial('sub-1', { billingPeriod: 'monthly' } as any, mockUser);

    expect(operationsService.convertTrial).toHaveBeenCalledWith('sub-1', 'org-1', 'monthly', 'user-1');
    expect(result).toEqual({ success: true, data: mockResult });
  });

  it('upgradePlan delegates with plan code and optional billing period', async () => {
    const mockResult = {
      subscriptionId: 'sub-1',
      fromPlanCode: 'pro',
      toPlanCode: 'team',
      direction: 'upgrade',
      proration: {},
      effectiveAt: new Date(),
      status: SubscriptionState.ACTIVE,
    };
    (operationsService.upgradePlan as jest.Mock).mockResolvedValue(mockResult);

    const result = await controller.upgradePlan(
      { targetPlanCode: 'team', billingPeriod: 'annual' } as any,
      mockUser,
    );

    expect(operationsService.upgradePlan).toHaveBeenCalledWith('org-1', 'team', 'annual', 'user-1');
    expect(result.success).toBe(true);
  });

  it('downgradePlan defaults immediate to false', async () => {
    const mockResult = {
      subscriptionId: 'sub-1',
      fromPlanCode: 'pro',
      toPlanCode: 'edu',
      direction: 'downgrade',
      proration: {},
      effectiveAt: new Date(),
      status: SubscriptionState.MIGRATING,
    };
    (operationsService.downgradePlan as jest.Mock).mockResolvedValue(mockResult);

    await controller.downgradePlan(
      { targetPlanCode: 'edu', immediate: undefined } as any,
      mockUser,
    );

    expect(operationsService.downgradePlan).toHaveBeenCalledWith(
      'org-1',
      'edu',
      undefined,
      false,
      'user-1',
    );
  });

  it('pauseSubscription delegates with reason', async () => {
    const mockResult = {
      subscriptionId: 'sub-1',
      pausedAt: new Date(),
      status: SubscriptionState.SUSPENDED,
    };
    (operationsService.pauseSubscription as jest.Mock).mockResolvedValue(mockResult);

    const result = await controller.pauseSubscription(
      'sub-1',
      { reason: 'Going on vacation' } as any,
      mockUser,
    );

    expect(operationsService.pauseSubscription).toHaveBeenCalledWith(
      'sub-1',
      'org-1',
      'user-1',
      'Going on vacation',
    );
    expect(result.success).toBe(true);
  });

  it('resumeSubscription delegates correctly', async () => {
    const mockResult = {
      subscriptionId: 'sub-1',
      resumedAt: new Date(),
      status: SubscriptionState.ACTIVE,
    };
    (operationsService.resumeSubscription as jest.Mock).mockResolvedValue(mockResult);

    const result = await controller.resumeSubscription('sub-1', mockUser);

    expect(operationsService.resumeSubscription).toHaveBeenCalledWith('sub-1', 'org-1', 'user-1');
    expect(result.success).toBe(true);
  });

  it('reactivateSubscription delegates correctly', async () => {
    const mockResult = {
      subscriptionId: 'sub-1',
      planCode: 'pro',
      status: SubscriptionState.ACTIVE,
    };
    (operationsService.reactivateSubscription as jest.Mock).mockResolvedValue(mockResult);

    const result = await controller.reactivateSubscription('sub-1', mockUser);

    expect(operationsService.reactivateSubscription).toHaveBeenCalledWith('sub-1', 'org-1', 'user-1');
    expect(result.success).toBe(true);
  });
});
