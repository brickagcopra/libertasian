import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { InternalDerivativesController } from './internal-derivatives.controller';
import { InternalDerivativesService } from './internal-derivatives.service';

/**
 * Module for internal service-to-service endpoints. Protected by
 * `InternalAuthGuard` (shared-secret), not JWT. The Python worker-service
 * calls these endpoints to write derivative artifacts and update job status.
 */
@Module({
  imports: [PrismaModule],
  controllers: [InternalDerivativesController],
  providers: [InternalDerivativesService],
})
export class InternalModule {}
