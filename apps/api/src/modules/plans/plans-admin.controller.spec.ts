import { Test, TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditService } from '../audit/audit.service';
import { PlansAdminController } from './plans-admin.controller';
import { PlansService } from './plans.service';

const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

describe('PlansAdminController', () => {
  let controller: PlansAdminController;
  let plansService: jest.Mocked<PlansService>;
  let auditService: jest.Mocked<AuditService>;

  const mockUser = {
    sub: 'user-1',
    email: 'admin@test.com',
    organizationId: 'org-1',
    role: 'owner',
  };

  const mockPlan = {
    id: 'plan-1',
    code: 'pro',
    name: 'Pro',
    displayName: 'Professional',
    isFeatured: true,
    featuredLabel: 'Most Popular',
    ctaText: 'Start Now',
    highlightColor: 'emerald',
    prices: [],
    entitlements: [],
  };

  const mockPrice = {
    id: 'price-1',
    planId: 'plan-1',
    billingInterval: 'monthly',
    amount: 99900,
    currency: 'PHP',
    isActive: true,
  };

  const mockEntitlement = {
    id: 'ent-1',
    planId: 'plan-1',
    key: 'aiAnswers',
    valueType: 'unlimited',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlansAdminController],
      providers: [
        {
          provide: PlansService,
          useValue: {
            findAllAdmin: jest.fn().mockResolvedValue([mockPlan]),
            findById: jest.fn().mockResolvedValue(mockPlan),
            create: jest.fn().mockResolvedValue(mockPlan),
            update: jest.fn().mockResolvedValue(mockPlan),
            archive: jest.fn().mockResolvedValue(mockPlan),
            comparePlans: jest.fn().mockResolvedValue({
              fromPlan: 'free',
              toPlan: 'pro',
              direction: 'upgrade',
              addedEntitlements: [],
              removedEntitlements: [],
              changedEntitlements: [],
            }),
            createPrice: jest.fn().mockResolvedValue(mockPrice),
            updatePrice: jest.fn().mockResolvedValue(mockPrice),
            deactivatePrice: jest.fn().mockResolvedValue(mockPrice),
            createEntitlement: jest.fn().mockResolvedValue(mockEntitlement),
            updateEntitlement: jest.fn().mockResolvedValue(mockEntitlement),
            deleteEntitlement: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: AuditService,
          useValue: {
            log: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue(mockGuard)
      .overrideGuard(MfaGuard).useValue(mockGuard)
      .overrideGuard(TenantGuard).useValue(mockGuard)
      .overrideGuard(PermissionsGuard).useValue(mockGuard)
      .compile();

    controller = module.get<PlansAdminController>(PlansAdminController);
    plansService = module.get(PlansService);
    auditService = module.get(AuditService);
  });

  // ---- Plan CRUD ----

  describe('listPlans', () => {
    it('should return all plans', async () => {
      const result = await controller.listPlans();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(plansService.findAllAdmin).toHaveBeenCalled();
    });
  });

  describe('getPlan', () => {
    it('should return a plan by ID', async () => {
      const result = await controller.getPlan('plan-1');
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockPlan);
    });

    it('should include display flag fields in response', async () => {
      const result = await controller.getPlan('plan-1');
      expect(result.data).toEqual(
        expect.objectContaining({
          isFeatured: true,
          featuredLabel: 'Most Popular',
          ctaText: 'Start Now',
          highlightColor: 'emerald',
        }),
      );
    });
  });

  describe('createPlan', () => {
    it('should create a plan and log audit', async () => {
      const dto = { code: 'pro', name: 'Pro', type: 'standard' };
      const result = await controller.createPlan(dto, mockUser as never, '127.0.0.1');
      expect(result.success).toBe(true);
      expect(plansService.create).toHaveBeenCalledWith(dto);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'plan.create',
          entityType: 'plan',
        }),
      );
    });
  });

  describe('updatePlan', () => {
    it('should update a plan and log audit', async () => {
      const dto = { name: 'Updated Pro' };
      const result = await controller.updatePlan('plan-1', dto, mockUser as never, '127.0.0.1');
      expect(result.success).toBe(true);
      expect(plansService.update).toHaveBeenCalledWith('plan-1', dto);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'plan.update',
        }),
      );
    });

    it('should pass display flag fields through to service', async () => {
      const dto = {
        isFeatured: true,
        featuredLabel: 'Best Value',
        ctaText: 'Get Started',
        highlightColor: 'amber',
      };
      const result = await controller.updatePlan('plan-1', dto, mockUser as never, '127.0.0.1');
      expect(result.success).toBe(true);
      expect(plansService.update).toHaveBeenCalledWith('plan-1', dto);
    });
  });

  describe('archivePlan', () => {
    it('should archive a plan and log audit', async () => {
      const result = await controller.archivePlan('plan-1', mockUser as never, '127.0.0.1');
      expect(result.success).toBe(true);
      expect(plansService.archive).toHaveBeenCalledWith('plan-1');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'plan.archive',
        }),
      );
    });
  });

  // ---- Plan Comparison ----

  describe('comparePlans', () => {
    it('should compare two plans', async () => {
      const result = await controller.comparePlans('free', 'pro');
      expect(result.success).toBe(true);
      expect(result.data.direction).toBe('upgrade');
      expect(plansService.comparePlans).toHaveBeenCalledWith('free', 'pro');
    });
  });

  // ---- Price Management ----

  describe('createPrice', () => {
    it('should create a price and log audit', async () => {
      const dto = { billingInterval: 'monthly', amount: 99900 };
      const result = await controller.createPrice('plan-1', dto, mockUser as never, '127.0.0.1');
      expect(result.success).toBe(true);
      expect(plansService.createPrice).toHaveBeenCalledWith('plan-1', dto);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'plan.price_create',
        }),
      );
    });
  });

  describe('updatePrice', () => {
    it('should update a price and log audit', async () => {
      const dto = { amount: 89900 };
      const result = await controller.updatePrice('plan-1', 'price-1', dto, mockUser as never, '127.0.0.1');
      expect(result.success).toBe(true);
      expect(plansService.updatePrice).toHaveBeenCalledWith('plan-1', 'price-1', dto);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'plan.price_update',
        }),
      );
    });
  });

  describe('deactivatePrice', () => {
    it('should deactivate a price and log audit', async () => {
      const result = await controller.deactivatePrice('plan-1', 'price-1', mockUser as never, '127.0.0.1');
      expect(result.success).toBe(true);
      expect(plansService.deactivatePrice).toHaveBeenCalledWith('plan-1', 'price-1');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'plan.price_deactivate',
        }),
      );
    });
  });

  // ---- Entitlement Management ----

  describe('createEntitlement', () => {
    it('should create an entitlement and log audit', async () => {
      const dto = { key: 'aiAnswers', valueType: 'unlimited' };
      const result = await controller.createEntitlement('plan-1', dto, mockUser as never, '127.0.0.1');
      expect(result.success).toBe(true);
      expect(plansService.createEntitlement).toHaveBeenCalledWith('plan-1', dto);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'plan.entitlement_create',
        }),
      );
    });
  });

  describe('updateEntitlement', () => {
    it('should update an entitlement and log audit', async () => {
      const dto = { numericValue: 200 };
      const result = await controller.updateEntitlement('plan-1', 'ent-1', dto, mockUser as never, '127.0.0.1');
      expect(result.success).toBe(true);
      expect(plansService.updateEntitlement).toHaveBeenCalledWith('plan-1', 'ent-1', dto);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'plan.entitlement_update',
        }),
      );
    });
  });

  describe('deleteEntitlement', () => {
    it('should delete an entitlement and log audit', async () => {
      const result = await controller.deleteEntitlement('plan-1', 'ent-1', mockUser as never, '127.0.0.1');
      expect(result.success).toBe(true);
      expect(result.data.message).toBe('Entitlement deleted');
      expect(plansService.deleteEntitlement).toHaveBeenCalledWith('plan-1', 'ent-1');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'plan.entitlement_delete',
        }),
      );
    });
  });
});
