import { Global, Module } from '@nestjs/common';

import { PlansAdminController } from './plans-admin.controller';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

@Global()
@Module({
  controllers: [PlansController, PlansAdminController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
