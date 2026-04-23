import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { AiSettingsModule } from '../ai-settings/ai-settings.module';
import { DigestsModule } from '../digests/digests.module';
import { DerivativesAdminController } from './derivatives-admin.controller';
import { DerivativesAdminService } from './derivatives-admin.service';
import { DerivativesReviewService } from './derivatives-review.service';

@Module({
  imports: [PrismaModule, AiSettingsModule, DigestsModule],
  controllers: [DerivativesAdminController],
  providers: [DerivativesAdminService, DerivativesReviewService],
  exports: [DerivativesReviewService],
})
export class DerivativesAdminModule {}
