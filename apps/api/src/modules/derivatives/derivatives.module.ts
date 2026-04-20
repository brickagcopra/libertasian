import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { DerivativesController, DerivativesPublicFeatureFlagGuard } from './derivatives.controller';
import { DerivativesService } from './derivatives.service';

@Module({
  imports: [PrismaModule],
  controllers: [DerivativesController],
  providers: [DerivativesService, DerivativesPublicFeatureFlagGuard],
  exports: [DerivativesService],
})
export class DerivativesModule {}
