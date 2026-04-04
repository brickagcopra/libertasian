import { Global, Module, forwardRef } from '@nestjs/common';

import { CouponsModule } from '../coupons/coupons.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { PricingEngineService } from './pricing-engine.service';

@Global()
@Module({
  imports: [forwardRef(() => CouponsModule), forwardRef(() => PromotionsModule)],
  providers: [PricingEngineService],
  exports: [PricingEngineService],
})
export class PricingModule {}
