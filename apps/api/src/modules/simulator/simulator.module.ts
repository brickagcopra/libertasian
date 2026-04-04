import { Module } from '@nestjs/common';
import { CouponsModule } from '../coupons/coupons.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { SimulatorService } from './simulator.service';
import { SimulatorAdminController } from './simulator-admin.controller';

@Module({
  imports: [CouponsModule, PromotionsModule],
  controllers: [SimulatorAdminController],
  providers: [SimulatorService],
})
export class SimulatorModule {}
