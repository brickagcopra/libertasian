import { Test, TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SimulatorAdminController } from './simulator-admin.controller';
import { SimulatorService } from './simulator.service';
import { AuditService } from '../audit/audit.service';

const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

describe('SimulatorAdminController', () => {
  let controller: SimulatorAdminController;
  let simulatorService: jest.Mocked<SimulatorService>;
  let auditService: jest.Mocked<AuditService>;

  const mockUser = {
    sub: 'admin-user-id',
    email: 'admin@libertasian.com',
    organizationId: 'org-1',
    role: 'admin',
  } as never;

  const mockIp = '127.0.0.1';

  beforeEach(async () => {
    simulatorService = {
      simulateTransition: jest.fn(),
      simulateLifecycle: jest.fn(),
      simulatePricing: jest.fn(),
      simulateProration: jest.fn(),
      simulateCoupon: jest.fn(),
      simulatePromotion: jest.fn(),
      simulateRevenueImpact: jest.fn(),
    } as unknown as jest.Mocked<SimulatorService>;

    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SimulatorAdminController],
      providers: [
        { provide: SimulatorService, useValue: simulatorService },
        { provide: AuditService, useValue: auditService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue(mockGuard)
      .overrideGuard(MfaGuard).useValue(mockGuard)
      .overrideGuard(TenantGuard).useValue(mockGuard)
      .overrideGuard(PermissionsGuard).useValue(mockGuard)
      .compile();

    controller = module.get<SimulatorAdminController>(SimulatorAdminController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ---- Delegation tests ----

  describe('simulateTransition', () => {
    it('should delegate to service and audit', async () => {
      const mockResult = { valid: true, fromState: 'active', action: 'REQUEST_CANCEL', toState: 'cancelling' };
      simulatorService.simulateTransition.mockReturnValue(mockResult as never);

      const result = await controller.simulateTransition(
        { currentState: 'active', action: 'REQUEST_CANCEL' },
        mockUser,
        mockIp,
      );

      expect(result).toEqual({ success: true, data: mockResult });
      expect(simulatorService.simulateTransition).toHaveBeenCalledWith({
        currentState: 'active',
        action: 'REQUEST_CANCEL',
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'admin-user-id',
          actorType: 'admin',
          action: 'simulator.transition',
          entityType: 'Simulator',
        }),
      );
    });
  });

  describe('simulateLifecycle', () => {
    it('should delegate to service and audit', async () => {
      const mockResult = { startingState: 'provisioning', steps: [], finalState: 'active' };
      simulatorService.simulateLifecycle.mockReturnValue(mockResult as never);

      const result = await controller.simulateLifecycle(
        { startingState: 'provisioning', actions: ['ACTIVATE'] },
        mockUser,
        mockIp,
      );

      expect(result).toEqual({ success: true, data: mockResult });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'simulator.lifecycle' }),
      );
    });
  });

  describe('simulatePricing', () => {
    it('should delegate to service and audit', async () => {
      const mockResult = { basePriceAmount: 99900, finalAmount: 99900, simulatedAt: 'now' };
      simulatorService.simulatePricing.mockResolvedValue(mockResult as never);

      const result = await controller.simulatePricing(
        { organizationId: 'org-1', planCode: 'pro', billingPeriod: 'monthly' },
        mockUser,
        mockIp,
      );

      expect(result).toEqual({ success: true, data: mockResult });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'simulator.pricing' }),
      );
    });
  });

  describe('simulateProration', () => {
    it('should delegate to service and audit', async () => {
      const mockResult = { creditAmount: 16650, chargeAmount: 41625, netAmount: 24975 };
      simulatorService.simulateProration.mockResolvedValue(mockResult as never);

      const result = await controller.simulateProration(
        {
          currentPlanCode: 'pro',
          newPlanCode: 'team',
          billingPeriod: 'monthly',
          periodStart: '2026-03-01T00:00:00.000Z',
          periodEnd: '2026-04-01T00:00:00.000Z',
        },
        mockUser,
        mockIp,
      );

      expect(result).toEqual({ success: true, data: mockResult });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'simulator.proration' }),
      );
    });
  });

  describe('simulateCoupon', () => {
    it('should delegate to service and audit', async () => {
      const mockResult = { couponCode: 'LAUNCH2026', valid: true, errors: [] };
      simulatorService.simulateCoupon.mockResolvedValue(mockResult as never);

      const result = await controller.simulateCoupon(
        { couponCode: 'LAUNCH2026', planCode: 'pro', billingPeriod: 'monthly' },
        mockUser,
        mockIp,
      );

      expect(result).toEqual({ success: true, data: mockResult });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'simulator.coupon' }),
      );
    });
  });

  describe('simulatePromotion', () => {
    it('should delegate to service and audit', async () => {
      const mockResult = { promotionId: 'promo-1', eligible: true, errors: [] };
      simulatorService.simulatePromotion.mockResolvedValue(mockResult as never);

      const result = await controller.simulatePromotion(
        { promotionId: 'promo-1', organizationId: 'org-1', planCode: 'pro', billingPeriod: 'monthly' },
        mockUser,
        mockIp,
      );

      expect(result).toEqual({ success: true, data: mockResult });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'simulator.promotion' }),
      );
    });
  });

  describe('simulateRevenueImpact', () => {
    it('should delegate to service and audit', async () => {
      const mockResult = { sourceType: 'coupon', sourceId: 'coupon-1', totalDiscountAmount: 69960 };
      simulatorService.simulateRevenueImpact.mockResolvedValue(mockResult as never);

      const result = await controller.simulateRevenueImpact(
        { couponId: 'coupon-1', plans: [{ planCode: 'pro', billingPeriod: 'monthly' }] },
        mockUser,
        mockIp,
      );

      expect(result).toEqual({ success: true, data: mockResult });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'simulator.revenue_impact',
          metadata: expect.objectContaining({
            input: expect.objectContaining({ couponId: 'coupon-1', planCount: 1 }),
          }),
        }),
      );
    });

    it('should pass promotionId in audit metadata', async () => {
      const mockResult = { sourceType: 'promotion', sourceId: 'promo-1' };
      simulatorService.simulateRevenueImpact.mockResolvedValue(mockResult as never);

      await controller.simulateRevenueImpact(
        { promotionId: 'promo-1', plans: [{ planCode: 'pro', billingPeriod: 'monthly' }] },
        mockUser,
        mockIp,
      );

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            input: expect.objectContaining({ couponId: null, promotionId: 'promo-1' }),
          }),
        }),
      );
    });
  });
});
