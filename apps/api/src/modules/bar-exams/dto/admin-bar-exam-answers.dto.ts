import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type AdminAnswerReviewStatus = (typeof REVIEW_STATUSES)[number];

/**
 * GET /admin/bar-exams/answers — list/filter query params.
 *
 * Cursor-based pagination keyed by ``createdAt + id`` so the queue
 * order matches the (review_status, created_at) index.
 */
export class ListBarExamAnswersQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by review status. Defaults to "pending".',
    enum: REVIEW_STATUSES,
  })
  @IsOptional()
  @IsString()
  @IsIn([...REVIEW_STATUSES])
  reviewStatus?: AdminAnswerReviewStatus;

  @ApiPropertyOptional({ description: 'Cursor — id of the previous page tail.' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/**
 * POST /admin/bar-exams/answers/:id/reject — optional reason.
 */
export class RejectBarExamAnswerDto {
  @ApiPropertyOptional({
    description: 'Free-text rejection reason, stored in the audit log.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * POST /admin/bar-exams/answers/dispatch-generation.
 *
 * Filters resolve to a list of question_ids to send to the worker. The
 * controller hard-caps the resolved set at 50 (defense in depth — the
 * worker enforces the same cap).
 */
export class DispatchAnswerGenerationDto {
  @ApiPropertyOptional({
    description: 'Generate answers for these specific question UUIDs.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  questionIds?: string[];

  @ApiPropertyOptional({ description: 'Generate for every question in this sitting.' })
  @IsOptional()
  @IsUUID()
  sittingId?: string;

  @ApiPropertyOptional({ minimum: 2006, maximum: 2030 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2006)
  @Max(2030)
  year?: number;

  @ApiPropertyOptional({
    description: 'Filter by subject_study_code on the sitting (e.g. "criminal_law").',
    maxLength: 40,
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  subjectCode?: string;
}
