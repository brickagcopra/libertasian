import { Test, TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditService } from '../audit/audit.service';
import { CouponService } from './coupon.service';
import { CouponAdminController } from './coupon-admin.controller';

const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

describe('CouponAdminController', () => {
  let controller: CouponAdminController;
  let couponService: Record<string, jest.Mock>;
  let auditService: Record<string, jest.Mock>;

  const USER = { sub: 'user-1', organizationId: 'org-1', email: 'admin@test.com' } as never;
  const IP = '127.0.0.1';
  const COUPON_ID = '00000000-0000-0000-0000-000000000010';

  const mockCoupon = {
    id: COUPON_ID,
    code: 'SAVE20',
    name: '20% Off',
    discountType: 'percentage',
    discountValue: 20,
    isActive: true,
    isArchived: false,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    couponService = {
      list: jest.fn().mockResolvedValue({ data: [mockCoupon], nextCursor: undefined, hasNext: false }),
      findById: jest.fn().mockResolvedValue(mockCoupon),
      create: jest.fn().mockResolvedValue(mockCoupon),
      update: jest.fn().mockResolvedValue(mockCoupon),
      archive: jest.fn().mockResolvedValue({ ...mockCoupon, isArchived: true }),
      toggleActive: jest.fn().mockResolvedValue(mockCoupon),
      getRedemptionHistory: jest.fn().mockResolvedValue({ data: [], nextCursor: undefined, hasNext: false }),
      assignUsers: jest.fn().mockResolvedValue({ count: 2 }),
      assignOrgs: jest.fn().mockResolvedValue({ count: 1 }),
      setPlanRules: jest.fn().mockResolvedValue([{ planCode: 'pro', ruleType: 'include' }]),
    };

    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CouponAdminController],
      providers: [
        { provide: CouponService, useValue: couponService },
        { provide: AuditService, useValue: auditService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue(mockGuard)
      .overrideGuard(MfaGuard).useValue(mockGuard)
      .overrideGuard(TenantGuard).useValue(mockGuard)
      .overrideGuard(PermissionsGuard).useValue(mockGuard)
      .compile();

    controller = module.get<CouponAdminController>(CouponAdminController);
  });

  afterEach(() => jest.clearAllMocks());

  // ---- List ----

  describe('listCoupons', () => {
    it('should return paginated coupon list', async () => {
      const result = await controller.listCoupons({ limit: 20 });
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.hasNext).toBe(false);
      expect(couponService.list).toHaveBeenCalledWith({ limit: 20 });
    });

    it('should pass filters through to service', async () => {
      await controller.listCoupons({ discountType: 'percentage', isActive: true, search: 'SAVE' });
      expect(couponService.list).toHaveBeenCalledWith({ discountType: 'percentage', isActive: true, search: 'SAVE' });
    });
  });

  // ---- Get ----

  describe('getCoupon', () => {
    it('should return coupon detail', async () => {
      const result = await controller.getCoupon(COUPON_ID);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockCoupon);
      expect(couponService.findById).toHaveBeenCalledWith(COUPON_ID);
    });
  });

  // ---- Create ----

  describe('createCoupon', () => {
    it('should create coupon and log audit', async () => {
      const dto = { code: 'SAVE20', name: '20% Off', discountType: 'percentage', discountValue: 20 } as never;
      const result = await controller.createCoupon(dto, USER, IP);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockCoupon);
      expect(couponService.create).toHaveBeenCalledWith(dto, 'user-1');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'user-1',
          actorType: 'admin',
          action: 'coupon.create',
          entityType: 'Coupon',
          entityId: COUPON_ID,
        }),
      );
    });
  });

  // ---- Update ----

  describe('updateCoupon', () => {
    it('should update coupon and log audit', async () => {
      const dto = { name: 'Updated Name' } as never;
      const result = await controller.updateCoupon(COUPON_ID, dto, USER, IP);

      expect(result.success).toBe(true);
      expect(couponService.update).toHaveBeenCalledWith(COUPON_ID, dto);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'coupon.update',
          entityId: COUPON_ID,
        }),
      );
    });
  });

  // ---- Archive ----

  describe('archiveCoupon', () => {
    it('should archive coupon and log audit', async () => {
      const result = await controller.archiveCoupon(COUPON_ID, USER, IP);

      expect(result.success).toBe(true);
      expect(couponService.archive).toHaveBeenCalledWith(COUPON_ID);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'coupon.archive' }),
      );
    });
  });

  // ---- Activate / Deactivate ----

  describe('activateCoupon', () => {
    it('should activate coupon and log audit', async () => {
      const result = await controller.activateCoupon(COUPON_ID, USER, IP);

      expect(result.success).toBe(true);
      expect(couponService.toggleActive).toHaveBeenCalledWith(COUPON_ID, true);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'coupon.activate' }),
      );
    });
  });

  describe('deactivateCoupon', () => {
    it('should deactivate coupon and log audit', async () => {
      const result = await controller.deactivateCoupon(COUPON_ID, USER, IP);

      expect(result.success).toBe(true);
      expect(couponService.toggleActive).toHaveBeenCalledWith(COUPON_ID, false);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'coupon.deactivate' }),
      );
    });
  });

  // ---- Redemptions ----

  describe('getRedemptions', () => {
    it('should return paginated redemption history', async () => {
      const result = await controller.getRedemptions(COUPON_ID, { limit: 20 });

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
      expect(couponService.getRedemptionHistory).toHaveBeenCalledWith(COUPON_ID, { limit: 20 });
    });

    it('should pass status filter', async () => {
      await controller.getRedemptions(COUPON_ID, { status: 'redeemed' });
      expect(couponService.getRedemptionHistory).toHaveBeenCalledWith(
        COUPON_ID,
        { status: 'redeemed' },
      );
    });
  });

  // ---- Assign Users ----

  describe('assignUsers', () => {
    it('should assign users and log audit', async () => {
      const dto = { userIds: ['u1', 'u2'] } as never;
      const result = await controller.assignUsers(COUPON_ID, dto, USER, IP);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ count: 2 });
      expect(couponService.assignUsers).toHaveBeenCalledWith(COUPON_ID, ['u1', 'u2']);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'coupon.assign_users',
          metadata: expect.objectContaining({ userCount: 2 }),
        }),
      );
    });
  });

  // ---- Assign Orgs ----

  describe('assignOrgs', () => {
    it('should assign orgs and log audit', async () => {
      const dto = { organizationIds: ['org-1'] } as never;
      const result = await controller.assignOrgs(COUPON_ID, dto, USER, IP);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ count: 1 });
      expect(couponService.assignOrgs).toHaveBeenCalledWith(COUPON_ID, ['org-1']);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'coupon.assign_orgs',
          metadata: expect.objectContaining({ orgCount: 1 }),
        }),
      );
    });
  });

  // ---- Plan Rules ----

  describe('setPlanRules', () => {
    it('should set plan rules and log audit', async () => {
      const dto = { rules: [{ planCode: 'pro', ruleType: 'include' }] } as never;
      const result = await controller.setPlanRules(COUPON_ID, dto, USER, IP);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([{ planCode: 'pro', ruleType: 'include' }]);
      expect(couponService.setPlanRules).toHaveBeenCalledWith(COUPON_ID, [{ planCode: 'pro', ruleType: 'include' }]);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'coupon.set_plan_rules',
          metadata: expect.objectContaining({ ruleCount: 1 }),
        }),
      );
    });
  });
});
