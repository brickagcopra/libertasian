import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { SubjectsModule } from '../subjects/subjects.module';
import { DerivativeArtifactController } from './derivative-artifact.controller';
import { DerivativeArtifactService } from './derivative-artifact.service';

/**
 * Foundation module for the generalised derivative artifact write path
 * (§2.2, §4.5). Provides the `DerivativeArtifactService` for MCQ,
 * EssayPrompt, and BarExamSitting creation, plus a controller with
 * admin-facing write endpoints. The derivative generation pipeline
 * (Phase 3+) will depend on this service. SubjectsModule is imported
 * so the service can use SubjectsService for subject validation.
 */
@Module({
  imports: [PrismaModule, SubjectsModule],
  controllers: [DerivativeArtifactController],
  providers: [DerivativeArtifactService],
  exports: [DerivativeArtifactService],
})
export class DerivativeArtifactModule {}
