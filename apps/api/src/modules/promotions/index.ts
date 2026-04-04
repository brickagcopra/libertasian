export { PromotionsModule } from './promotions.module';
export { PromotionService } from './promotion.service';
export { PromotionRuleEngineService } from './promotion-rule-engine.service';
export { PromotionScheduler } from './promotion.scheduler';
export { PromotionAdminController } from './promotion-admin.controller';
export { PromotionController } from './promotion.controller';
export type {
  ApplyPromotionParams,
  ApplyPromotionResult,
} from './promotion.service';
export type {
  PromotionEligibilityResult,
  DiscountPreviewResult,
  ActivePromotionForPricing,
} from './promotion-rule-engine.service';
