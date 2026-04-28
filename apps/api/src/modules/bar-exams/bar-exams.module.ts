import { Module } from '@nestjs/common';

import { RedisModule } from '../../common/services/redis.module';
import { CeleryDispatcherService } from '../../common/services/celery-dispatcher.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AdminBarExamsController } from './admin-bar-exams.controller';
import { AdminBarExamsService } from './admin-bar-exams.service';
import { BarExamsController } from './bar-exams.controller';
import { BarExamsService } from './bar-exams.service';

@Module({
  imports: [PrismaModule, RedisModule, AuditModule],
  controllers: [BarExamsController, AdminBarExamsController],
  providers: [BarExamsService, AdminBarExamsService, CeleryDispatcherService],
  exports: [BarExamsService],
})
export class BarExamsModule {}
