import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ResearchWorkspacesController } from './research-workspaces.controller';
import { ResearchWorkspacesProcessor } from './research-workspaces.processor';
import { ResearchWorkspacesService } from './research-workspaces.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'research-workspaces' }),
    PrismaModule,
    SubscriptionsModule,
  ],
  controllers: [ResearchWorkspacesController],
  providers: [ResearchWorkspacesService, ResearchWorkspacesProcessor],
  exports: [ResearchWorkspacesService],
})
export class ResearchWorkspacesModule {}
