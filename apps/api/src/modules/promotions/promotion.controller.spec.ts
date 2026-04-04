import { Test, TestingModule } from '@nestjs/testing';

import { PromotionRuleEngineService } from './promotion-rule-engine.service';
import { PromotionController } from './promotion.controller';

describe('PromotionController', () => {
  let controller: PromotionController;
  let ruleEngine: Record<string, jest.Mock>;

  const USER_ID = '00000000-0000-0000-0000-000000000002';
  const ORG_ID = '00000000-0000-0000-0000-000000000001';
  const mockUser = { sub: USER_ID, organizationId: ORG_ID, email: 'user@test.com' };

  beforeEach(async () => {
    ruleEngine = {
      findEligiblePromotions: jest.fn().mockResolvedValue([]),
      getActivePromotionsForPricing: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PromotionController],
      providers: [
        { provide: PromotionRuleEngineService, useValue: ruleEngine },
      ],
    }).compile();

    controller = module.get<PromotionController>(PromotionController);
  });

  describe('findEligiblePromotions', () => {
    it('should return eligible promotions for checkout', async () => {
      const dto = { planCode: 'pro', billingPeriod: 'monthly' };
      const result = await controller.findEligiblePromotions(dto as never, mockUser as never);

      expect(result.success).toBe(true);
      expect(ruleEngine.findEligiblePromotions).toHaveBeenCalledWith(
        ORG_ID, USER_ID, 'pro', 'monthly',
      );
    });

    it('should return eligible promotions with discount previews', async () => {
      ruleEngine.findEligiblePromotions.mockResolvedValue([
        {
          eligible: true,
          promotionId: 'promo-1',
          discountPreview: { originalAmount: 99900, discountAmount: 49950, finalAmount: 49950 },
        },
      ]);

      const dto = { planCode: 'pro', billingPeriod: 'monthly' };
      const result = await controller.findEligiblePromotions(dto as never, mockUser as never);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].eligible).toBe(true);
    });
  });

  describe('getActivePromotionsForPricing', () => {
    it('should return active promotions for pricing page', async () => {
      ruleEngine.getActivePromotionsForPricing.mockResolvedValue([
        { id: 'promo-1', name: 'Summer Sale', slug: 'summer-sale' },
      ]);

      const result = await controller.getActivePromotionsForPricing();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(ruleEngine.getActivePromotionsForPricing).toHaveBeenCalled();
    });
  });
});
