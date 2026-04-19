import { Test, TestingModule } from '@nestjs/testing';

import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

describe('PlansController', () => {
  let controller: PlansController;
  let plansService: jest.Mocked<PlansService>;

  const mockPlans = [
    {
      id: 'plan-1',
      code: 'free',
      name: 'Free',
      isVisible: true,
      isFeatured: false,
      featuredLabel: null,
      ctaText: null,
      highlightColor: null,
      prices: [],
      entitlements: [],
    },
    {
      id: 'plan-2',
      code: 'pro',
      name: 'Pro',
      isVisible: true,
      isFeatured: true,
      featuredLabel: 'Most Popular',
      ctaText: 'Start Now',
      highlightColor: 'emerald',
      prices: [
        { id: 'price-1', billingInterval: 'monthly', amount: 99900, currency: 'PHP', isActive: true },
      ],
      entitlements: [
        { id: 'ent-1', key: 'aiAnswers', valueType: 'unlimited' },
      ],
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlansController],
      providers: [
        {
          provide: PlansService,
          useValue: {
            findVisible: jest.fn().mockResolvedValue(mockPlans),
          },
        },
      ],
    }).compile();

    controller = module.get<PlansController>(PlansController);
    plansService = module.get(PlansService);
  });

  describe('listVisiblePlans', () => {
    it('should return visible plans with success wrapper', async () => {
      const result = await controller.listVisiblePlans();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(plansService.findVisible).toHaveBeenCalled();
    });

    it('should return empty array when no visible plans', async () => {
      plansService.findVisible.mockResolvedValue([]);

      const result = await controller.listVisiblePlans();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });

    it('should include display flag fields in plan responses', async () => {
      const result = await controller.listVisiblePlans();
      const proPlan = result.data.find((p: { code: string }) => p.code === 'pro');
      expect(proPlan).toEqual(
        expect.objectContaining({
          isFeatured: true,
          featuredLabel: 'Most Popular',
          ctaText: 'Start Now',
          highlightColor: 'emerald',
        }),
      );
      const freePlan = result.data.find((p: { code: string }) => p.code === 'free');
      expect(freePlan).toEqual(
        expect.objectContaining({
          isFeatured: false,
          featuredLabel: null,
          ctaText: null,
          highlightColor: null,
        }),
      );
    });
  });
});
