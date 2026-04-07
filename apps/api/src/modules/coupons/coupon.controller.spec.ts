import { Test, TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CouponService } from './coupon.service';
import { CouponController } from './coupon.controller';

const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

describe('CouponController', () => {
  let controller: CouponController;
  let couponService: { validateCoupon: jest.Mock };

  const USER = {
    sub: 'user-1',
    organizationId: 'org-1',
    email: 'test@test.com',
  } as never;

  beforeEach(async () => {
    couponService = {
      validateCoupon: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CouponController],
      providers: [{ provide: CouponService, useValue: couponService }],
    })
      .overrideGuard(JwtAuthGuard).useValue(mockGuard)
      .overrideGuard(TenantGuard).useValue(mockGuard)
      .compile();

    controller = module.get<CouponController>(CouponController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('validateCoupon', () => {
    it('should return valid result with discount preview', async () => {
      const validation = {
        valid: true,
        coupon: { id: 'c-1', code: 'SAVE20' },
        errors: [],
        discountPreview: {
          originalAmount: 99900,
          discountAmount: 19980,
          finalAmount: 79920,
          discountType: 'percentage',
          discountValue: 20,
          currency: 'PHP',
        },
      };
      couponService.validateCoupon.mockResolvedValue(validation);

      const result = await controller.validateCoupon(
        { code: 'SAVE20', planCode: 'pro', billingPeriod: 'monthly' },
        USER,
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(validation);
      expect(couponService.validateCoupon).toHaveBeenCalledWith(
        'SAVE20',
        'org-1',
        'user-1',
        'pro',
        'monthly',
      );
    });

    it('should return invalid result with errors', async () => {
      const validation = {
        valid: false,
        errors: ['Coupon code not found'],
      };
      couponService.validateCoupon.mockResolvedValue(validation);

      const result = await controller.validateCoupon(
        { code: 'INVALID', planCode: 'pro', billingPeriod: 'monthly' },
        USER,
      );

      expect(result.success).toBe(true);
      expect(result.data.valid).toBe(false);
      expect(result.data.errors).toContain('Coupon code not found');
    });

    it('should pass user organizationId and sub from JWT', async () => {
      couponService.validateCoupon.mockResolvedValue({ valid: false, errors: [] });

      await controller.validateCoupon(
        { code: 'CODE', planCode: 'edu', billingPeriod: 'annual' },
        { sub: 'uid-42', organizationId: 'oid-99' } as never,
      );

      expect(couponService.validateCoupon).toHaveBeenCalledWith(
        'CODE', 'oid-99', 'uid-42', 'edu', 'annual',
      );
    });
  });
});
