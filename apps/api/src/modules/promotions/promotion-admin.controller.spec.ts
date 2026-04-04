import { Test, TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditService } from '../audit/audit.service';
import { PromotionService } from './promotion.service';
import { PromotionAdminController } from './promotion-admin.controller';

const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

describe('PromotionAdminController', () => {
  let controller: PromotionAdminController;
  let promotionService: Record<string, jest.Mock>;
  let auditService: { log: jest.Mock };

  const PROMO_ID = '00000000-0000-0000-0000-000000000010';
  const USER_ID = '00000000-0000-0000-0000-000000000002';
  const REDEMPTION_ID = '00000000-0000-0000-0000-000000000020';

  const mockUser = { sub: USER_ID, organizationId: 'org-1', email: 'admin@test.com' };
  const mockIp = '127.0.0.1';

  const makePromotion = (overrides: Record<string, unknown> = {}) => ({
    id: PROMO_ID,
    name: 'Summer Sale',
    slug: 'summer-sale',
    promotionType: 'sale',
    status: 'draft',
    ...overrides,
  });

  beforeEach(async () => {
    promotionService = {
      list: jest.fn().mockResolvedValue({ data: [], hasNext: false, nextCursor: null }),
      findByIdWithStats: jest.fn().mockResolvedValue(makePromotion()),
      create: jest.fn().mockResolvedValue(makePromotion()),
      update: jest.fn().mockResolvedValue(makePromotion()),
      archive: jest.fn().mockResolvedValue(makePromotion({ status: 'archived' })),
      setStatus: jest.fn().mockResolvedValue(makePromotion({ status: 'active' })),
      getRedemptionHistory: jest.fn().mockResolvedValue({ data: [], hasNext: false, nextCursor: null }),
      revokeRedemption: jest.fn().mockResolvedValue(undefined),
      setRules: jest.fn().mockResolvedValue([]),
      setBenefits: jest.fn().mockResolvedValue([]),
      setPlanRules: jest.fn().mockResolvedValue([]),
    };

    auditService = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PromotionAdminController],
      providers: [
        { provide: PromotionService, useValue: promotionService },
        { provide: AuditService, useValue: auditService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue(mockGuard)
      .overrideGuard(MfaGuard).useValue(mockGuard)
      .overrideGuard(TenantGuard).useValue(mockGuard)
      .overrideGuard(PermissionsGuard).useValue(mockGuard)
      .compile();

    controller = module.get<PromotionAdminController>(PromotionAdminController);
  });

  describe('listPromotions', () => {
    it('should return paginated promotions', async () => {
      const result = await controller.listPromotions({});
      expect(result.success).toBe(true);
      expect(promotionService.list).toHaveBeenCalledWith({});
    });
  });

  describe('getPromotion', () => {
    it('should return promotion with stats', async () => {
      const result = await controller.getPromotion(PROMO_ID);
      expect(result.success).toBe(true);
      expect(promotionService.findByIdWithStats).toHaveBeenCalledWith(PROMO_ID);
    });
  });

  describe('createPromotion', () => {
    it('should create promotion and log audit', async () => {
      const dto = { name: 'Summer Sale', slug: 'summer-sale', promotionType: 'sale' as const };
      const result = await controller.createPromotion(dto as never, mockUser as never, mockIp);

      expect(result.success).toBe(true);
      expect(promotionService.create).toHaveBeenCalledWith(dto, USER_ID);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'promotion.create',
          actorType: 'admin',
        }),
      );
    });
  });

  describe('updatePromotion', () => {
    it('should update promotion and log audit', async () => {
      const dto = { name: 'Updated' };
      const result = await controller.updatePromotion(PROMO_ID, dto, mockUser as never, mockIp);

      expect(result.success).toBe(true);
      expect(promotionService.update).toHaveBeenCalledWith(PROMO_ID, dto);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'promotion.update' }),
      );
    });
  });

  describe('archivePromotion', () => {
    it('should archive promotion and log audit', async () => {
      const result = await controller.archivePromotion(PROMO_ID, mockUser as never, mockIp);

      expect(result.success).toBe(true);
      expect(promotionService.archive).toHaveBeenCalledWith(PROMO_ID);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'promotion.archive' }),
      );
    });
  });

  describe('activatePromotion', () => {
    it('should activate promotion and log audit', async () => {
      const result = await controller.activatePromotion(PROMO_ID, mockUser as never, mockIp);

      expect(result.success).toBe(true);
      expect(promotionService.setStatus).toHaveBeenCalledWith(PROMO_ID, 'active');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'promotion.activate' }),
      );
    });
  });

  describe('pausePromotion', () => {
    it('should pause promotion and log audit', async () => {
      promotionService.setStatus.mockResolvedValue(makePromotion({ status: 'paused' }));
      const result = await controller.pausePromotion(PROMO_ID, mockUser as never, mockIp);

      expect(result.success).toBe(true);
      expect(promotionService.setStatus).toHaveBeenCalledWith(PROMO_ID, 'paused');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'promotion.pause' }),
      );
    });
  });

  describe('getRedemptions', () => {
    it('should return paginated redemptions', async () => {
      const result = await controller.getRedemptions(PROMO_ID, {});
      expect(result.success).toBe(true);
      expect(promotionService.getRedemptionHistory).toHaveBeenCalledWith(PROMO_ID, {});
    });
  });

  describe('revokeRedemption', () => {
    it('should revoke redemption', async () => {
      const dto = { reason: 'Fraudulent activity' };
      const result = await controller.revokeRedemption(REDEMPTION_ID, dto, mockUser as never);

      expect(result.success).toBe(true);
      expect(promotionService.revokeRedemption).toHaveBeenCalledWith(
        REDEMPTION_ID, USER_ID, 'Fraudulent activity',
      );
    });
  });

  describe('setRules', () => {
    it('should set rules and log audit', async () => {
      const dto = { rules: [{ ruleType: 'date_range', configuration: {} }] };
      const result = await controller.setRules(PROMO_ID, dto as never, mockUser as never, mockIp);

      expect(result.success).toBe(true);
      expect(promotionService.setRules).toHaveBeenCalledWith(PROMO_ID, dto.rules);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'promotion.set_rules' }),
      );
    });
  });

  describe('setBenefits', () => {
    it('should set benefits and log audit', async () => {
      const dto = { benefits: [{ benefitType: 'percentage_discount', discountValue: 20 }] };
      const result = await controller.setBenefits(PROMO_ID, dto as never, mockUser as never, mockIp);

      expect(result.success).toBe(true);
      expect(promotionService.setBenefits).toHaveBeenCalledWith(PROMO_ID, dto.benefits);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'promotion.set_benefits' }),
      );
    });
  });

  describe('setPlanRules', () => {
    it('should set plan rules and log audit', async () => {
      const dto = { rules: [{ planCode: 'pro', ruleType: 'include' }] };
      const result = await controller.setPlanRules(PROMO_ID, dto as never, mockUser as never, mockIp);

      expect(result.success).toBe(true);
      expect(promotionService.setPlanRules).toHaveBeenCalledWith(PROMO_ID, dto.rules);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'promotion.set_plan_rules' }),
      );
    });
  });
});
