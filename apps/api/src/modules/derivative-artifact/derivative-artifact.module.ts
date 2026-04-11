import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { DerivativeArtifactService } from './derivative-artifact.service';

/**
 * Foundation module for the generalised derivative artifact write path
 * (§2.2, §4.5). Service-layer only — no controllers, no queue bindings.
 * The derivative generation pipeline (Phase 3+) will depend on this
 * service; per-type child-table modules (McqQuestion, EssayPrompt,
 * DocumentSubjectAssignment) will import it when they land.
 */
@Module({
  imports: [PrismaModule],
  providers: [DerivativeArtifactService],
  exports: [DerivativeArtifactService],
})
export class DerivativeArtifactModule {}
