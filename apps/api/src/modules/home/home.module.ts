import { Module } from '@nestjs/common';

import { RedisModule } from '../../common/services/redis.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [HomeController],
  providers: [HomeService],
  exports: [HomeService],
})
export class HomeModule {}
