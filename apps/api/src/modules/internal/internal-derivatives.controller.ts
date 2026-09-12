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
import { BudgetLedgerEntryDto, UpdateJobStatusDto, WriteClassificationDto, WriteDerivativeDto, WriteDigestDto, WriteDoctrinesDto, WriteEssayDto, WriteFlashcardsDto, WriteMcqBatchDto } from './dto';

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

  /**
   * Standalone budget-ledger write.
   *
   * Bar-exam answers are persisted by the worker straight to Postgres —
   * there is no artifact write for the ledger entry to ride along with —
   * so they post the entry here instead. Every other generator attaches
   * it to its own write call, which keeps the two atomic.
   */
  @Post('write-budget-ledger')
  async writeBudgetLedger(@Body() dto: BudgetLedgerEntryDto) {
    await this.service.recordBudgetLedgerEntry(dto);
    return { success: true };
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
