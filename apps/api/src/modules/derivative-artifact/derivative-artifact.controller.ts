import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuditService } from '../audit/audit.service';
import { DerivativeArtifactService } from './derivative-artifact.service';
import {
  CreateBarExamSittingDto,
  CreateDerivativeArtifactDto,
  CreateEssayPromptDto,
  CreateMcqQuestionDto,
} from './dto';
import type { ProvenanceInputDto } from './dto';

@ApiTags('Derivative Artifacts')
@Controller('derivative-artifacts')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DerivativeArtifactController {
  constructor(
    private readonly service: DerivativeArtifactService,
    private readonly auditService: AuditService,
  ) {}

  @Post('mcq-questions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an MCQ question with its derivative artifact' })
  async createMcqQuestion(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      artifact: Omit<CreateDerivativeArtifactDto, 'derivativeType' | 'contentJson'>;
      mcqQuestion: CreateMcqQuestionDto;
      provenanceRecords: ProvenanceInputDto[];
    },
  ) {
    const result = await this.service.createMcqQuestion({
      ...body.mcqQuestion,
      provenanceRecords: body.provenanceRecords,
    });

    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      organizationId: user.organizationId,
      action: 'derivative_artifact.create_mcq_question',
      entityType: 'derivative_artifact',
      entityId: result.artifact.id,
      metadata: { derivativeType: 'mcq_question' },
    });

    return { success: true, data: result };
  }

  @Post('essay-prompts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an essay prompt with its derivative artifact' })
  async createEssayPrompt(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      artifact: Omit<CreateDerivativeArtifactDto, 'derivativeType' | 'contentJson'>;
      essayPrompt: CreateEssayPromptDto;
      provenanceRecords: ProvenanceInputDto[];
    },
  ) {
    const result = await this.service.createEssayPrompt({
      ...body.essayPrompt,
      provenanceRecords: body.provenanceRecords,
    });

    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      organizationId: user.organizationId,
      action: 'derivative_artifact.create_essay_prompt',
      entityType: 'derivative_artifact',
      entityId: result.artifact.id,
      metadata: { derivativeType: 'essay_prompt' },
    });

    return { success: true, data: result };
  }

  @Post('bar-exam-sittings')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a bar exam sitting reference row' })
  async createBarExamSitting(
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateBarExamSittingDto,
  ) {
    const result = await this.service.createBarExamSitting(body);

    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      organizationId: user.organizationId,
      action: 'bar_exam_sitting.create',
      entityType: 'bar_exam_sitting',
      entityId: result.id,
      metadata: { year: result.year, part: result.part ?? null },
    });

    return { success: true, data: result };
  }
}
