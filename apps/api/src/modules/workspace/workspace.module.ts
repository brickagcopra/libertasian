import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { WorkspaceController, SharedContentController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';

@Module({
  imports: [PrismaModule],
  controllers: [WorkspaceController, SharedContentController],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
