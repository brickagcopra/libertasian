import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';

@Module({
  imports: [PrismaModule, SubscriptionsModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
