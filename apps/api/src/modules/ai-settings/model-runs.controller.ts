import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

import { InternalApiGuard } from '../../common/guards/internal-api.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { AiSettingsService } from './ai-settings.service';

class CreateModelRunDto {
  @IsString()
  runType!: string;

  @IsString()
  modelName!: string;

  @IsOptional()
  @IsString()
  modelVersion?: string;

  @IsOptional()
  @IsString()
  promptTemplateVersion?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tokensIn?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tokensOut?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  latencyMs?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @IsOptional()
  @IsString()
  inputRef?: string;

  @IsOptional()
  @IsString()
  outputRef?: string;
}

/**
 * Internal endpoint for the RAG service to report token usage and model run details.
 * Authenticated via X-Internal-Api-Key (no JWT required — service-to-service).
 */
@ApiTags('Internal — Model Runs')
@Controller('internal/model-runs')
@UseGuards(InternalApiGuard)
export class ModelRunsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiSettings: AiSettingsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Record a model run (internal service-to-service)' })
  async createModelRun(@Body() dto: CreateModelRunDto) {
    const modelRun = await this.prisma.modelRun.create({
      data: {
        runType: dto.runType,
        modelName: dto.modelName,
        modelVersion: dto.modelVersion,
        promptTemplateVersion: dto.promptTemplateVersion,
        tokensIn: dto.tokensIn,
        tokensOut: dto.tokensOut,
        latencyMs: dto.latencyMs,
        confidence: dto.confidence,
        inputRef: dto.inputRef,
        outputRef: dto.outputRef,
      },
    });

    // Check budget thresholds after recording usage
    // Fire-and-forget — don't block the response
    this.aiSettings.checkBudgetThresholds().catch(() => {});

    return { success: true, id: modelRun.id };
  }
}
