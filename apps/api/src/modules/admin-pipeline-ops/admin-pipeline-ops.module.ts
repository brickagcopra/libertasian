import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../../prisma/prisma.module';
import { InternalModule } from '../internal/internal.module';
import { AdminPipelineOpsController } from './admin-pipeline-ops.controller';
import { AdminPipelineOpsService } from './admin-pipeline-ops.service';

@Module({
  imports: [PrismaModule, ConfigModule, InternalModule],
  controllers: [AdminPipelineOpsController],
  providers: [AdminPipelineOpsService],
})
export class AdminPipelineOpsModule {}
