import { Module } from '@nestjs/common';

import { PromotionRuleEngineService } from './promotion-rule-engine.service';
import { PromotionService } from './promotion.service';
import { PromotionScheduler } from './promotion.scheduler';
import { PromotionAdminController } from './promotion-admin.controller';
import { PromotionController } from './promotion.controller';

@Module({
  controllers: [PromotionAdminController, PromotionController],
  providers: [PromotionRuleEngineService, PromotionService, PromotionScheduler],
  exports: [PromotionService, PromotionRuleEngineService],
})
export class PromotionsModule {}
