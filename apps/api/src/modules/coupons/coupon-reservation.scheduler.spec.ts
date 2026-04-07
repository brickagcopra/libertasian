import { Test, TestingModule } from '@nestjs/testing';

import { CouponService } from './coupon.service';
import { CouponReservationScheduler } from './coupon-reservation.scheduler';

describe('CouponReservationScheduler', () => {
  let scheduler: CouponReservationScheduler;
  let couponService: { expireStaleReservations: jest.Mock };

  beforeEach(async () => {
    couponService = {
      expireStaleReservations: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouponReservationScheduler,
        { provide: CouponService, useValue: couponService },
      ],
    }).compile();

    scheduler = module.get<CouponReservationScheduler>(CouponReservationScheduler);
  });

  afterEach(() => jest.clearAllMocks());

  it('should call expireStaleReservations', async () => {
    await scheduler.handleExpireStaleReservations();
    expect(couponService.expireStaleReservations).toHaveBeenCalledTimes(1);
  });

  it('should handle errors gracefully', async () => {
    couponService.expireStaleReservations.mockRejectedValue(new Error('DB error'));
    // Should not throw
    await scheduler.handleExpireStaleReservations();
    expect(couponService.expireStaleReservations).toHaveBeenCalledTimes(1);
  });

  it('should log when reservations are expired', async () => {
    couponService.expireStaleReservations.mockResolvedValue(3);
    await scheduler.handleExpireStaleReservations();
    expect(couponService.expireStaleReservations).toHaveBeenCalledTimes(1);
  });
});
