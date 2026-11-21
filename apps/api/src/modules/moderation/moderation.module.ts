import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommunitySanctionsService } from './community-sanctions.service';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';

/**
 * Platform moderation: the report queue, content decisions and community
 * sanctions. Depends only on Prisma, notifications and (global) RBAC/audit,
 * so FeedModule and CommunityModule can import it without a cycle.
 */
@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [ModerationController],
  providers: [ModerationService, CommunitySanctionsService],
  exports: [ModerationService, CommunitySanctionsService],
})
export class ModerationModule {}
