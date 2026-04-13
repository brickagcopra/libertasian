import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { InternalAuthGuard } from './internal-auth.guard';
import { InternalDerivativesService } from './internal-derivatives.service';
import { UpdateJobStatusDto, WriteClassificationDto, WriteDerivativeDto, WriteDigestDto, WriteDoctrinesDto, WriteEssayDto, WriteFlashcardsDto, WriteMcqBatchDto } from './dto';

/**
 * Internal endpoints for the Python worker-service to write derivative
 * artifacts and update job status. Protected by `InternalAuthGuard`
 * (shared-secret `X-Internal-Auth` header), NOT by JWT.
 *
 * Rate limiting is skipped for internal calls — the worker-service is
 * trusted and self-throttled by Celery concurrency settings.
 */
@Controller('internal/derivatives')
@UseGuards(InternalAuthGuard)
@SkipThrottle()
export class InternalDerivativesController {
  constructor(private readonly service: InternalDerivativesService) {}

  @Post('write')
  async writeDerivative(@Body() dto: WriteDerivativeDto) {
    return this.service.writeDerivative(dto);
  }

  @Post('write-digest')
  async writeDigest(@Body() dto: WriteDigestDto) {
    return this.service.writeDigest(dto);
  }

  @Post('write-doctrines')
  async writeDoctrines(@Body() dto: WriteDoctrinesDto) {
    return this.service.writeDoctrines(dto);
  }

  @Post('write-mcq-batch')
  async writeMcqBatch(@Body() dto: WriteMcqBatchDto) {
    return this.service.writeMcqBatch(dto);
  }

  @Post('write-essay')
  async writeEssay(@Body() dto: WriteEssayDto) {
    return this.service.writeEssay(dto);
  }

  @Post('write-flashcards')
  async writeFlashcards(@Body() dto: WriteFlashcardsDto) {
    return this.service.writeFlashcards(dto);
  }

  @Post('write-classification')
  async writeClassification(@Body() dto: WriteClassificationDto) {
    return this.service.writeClassification(dto);
  }

  @Post('jobs/:id/status')
  async updateJobStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobStatusDto,
  ) {
    await this.service.updateJobStatus(id, dto);
    return { success: true };
  }
}
