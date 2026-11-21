import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { ModerationModule } from '../moderation/moderation.module';
import { CommunityController } from './community.controller';
import { CommunityAdminController } from './community-admin.controller';
import { CommunityService } from './community.service';

@Module({
  imports: [PrismaModule, ModerationModule],
  controllers: [CommunityController, CommunityAdminController],
  providers: [CommunityService],
  exports: [CommunityService],
})
export class CommunityModule {}
