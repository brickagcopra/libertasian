import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type AdminAnswerReviewStatus = (typeof REVIEW_STATUSES)[number];

/**
 * ``'all'`` is a real filter value, not the absence of one. The list endpoint
 * defaults to ``'pending'``, so a UI chip that sent no ``reviewStatus`` to
 * mean "All" silently got the pending queue back — which is exactly what the
 * "All" chip did until this was added.
 */
const REVIEW_STATUS_FILTERS = [...REVIEW_STATUSES, 'all'] as const;
export type AdminAnswerReviewStatusFilter =
  (typeof REVIEW_STATUS_FILTERS)[number];

/**
 * Floor for any confidence-driven bulk action. Set by the digest/answer
 * scoring contract (CLAUDE.md § Digest Generation): below 0.70 a row is
 * `needs_human_review`, so it must never be swept into an approval by filter.
 */
export const MIN_BULK_CONFIDENCE = 0.7;

/**
 * GET /admin/bar-exams/answers — list/filter query params.
 *
 * Cursor-based pagination keyed by ``createdAt + id`` so the queue
 * order matches the (review_status, created_at) index.
 */
export class ListBarExamAnswersQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter by review status. Defaults to "pending". "all" applies no ' +
      'status filter.',
    enum: REVIEW_STATUS_FILTERS,
  })
  @IsOptional()
  @IsString()
  @IsIn([...REVIEW_STATUS_FILTERS])
  reviewStatus?: AdminAnswerReviewStatusFilter;

  @ApiPropertyOptional({ description: 'Filter by sitting year.', minimum: 2006, maximum: 2030 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2006)
  @Max(2030)
  year?: number;

  @ApiPropertyOptional({
    description: 'Filter by subject_study_code on the sitting.',
    maxLength: 40,
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  subjectCode?: string;

  @ApiPropertyOptional({
    description:
      'Only answers whose confidence is >= this value. Rows with a NULL ' +
      'confidence (priors-only v1 generations) are excluded — unscored is ' +
      'not the same claim as low-scoring.',
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minConfidence?: number;

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
 * Filters resolve to a question set, which becomes a
 * ``bar_exam_answer_generation_jobs`` row plus one item per question. There
 * is no cap: the old 50-cap combined with "first 50 by question number,
 * already-answered included" meant re-dispatching a filter re-picked the same
 * answered questions forever.
 */
export class DispatchAnswerGenerationDto {
  @ApiPropertyOptional({
    description: 'Generate answers for these specific question UUIDs.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
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

  @ApiPropertyOptional({
    description:
      'Exclude questions that already have an ai_generated answer. Default ' +
      'true — without it a re-dispatch resolves to the same answered rows ' +
      'and the worker skips every one of them.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  onlyMissing?: boolean;

  @ApiPropertyOptional({
    description:
      'Target every unanswered question in the corpus. The only way to ' +
      'dispatch without a filter — an explicit opt-in, never a default.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  allMissing?: boolean;

  @ApiPropertyOptional({
    description:
      'Also target questions whose ai_generated answer is still PENDING ' +
      'review — the worker regenerates those in place. Approved and ' +
      'rejected answers are never targeted, whatever else is set.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  regeneratePending?: boolean;

  @ApiPropertyOptional({
    description:
      'With regeneratePending: only replace pending answers scoring BELOW ' +
      'this, plus unscored (NULL confidence) ones — an unscored answer was ' +
      'never measured, so it is never excluded by a score ceiling.',
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  maxConfidence?: number;

  @ApiPropertyOptional({
    description:
      'Resolve and count only. Creates no job and no items; returns the ' +
      'total plus a per-year/subject breakdown.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

/**
 * GET /admin/bar-exams/answers/generation-jobs — list query.
 */
export class ListGenerationJobsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

/**
 * GET /admin/bar-exams/answers/generation-jobs/:id — failed-item paging.
 */
export class GenerationJobDetailQueryDto {
  @ApiPropertyOptional({ description: 'Cursor — id of the previous failed-item page tail.' })
  @IsOptional()
  @IsUUID()
  failedCursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  failedLimit?: number;
}

/**
 * Filter half of a bulk approve request. Approve-only: see
 * {@link BulkRejectBarExamAnswersDto} for why reject takes no filter.
 *
 * ``minConfidence`` is required here and floored at
 * {@link MIN_BULK_CONFIDENCE}: approving by filter is the one path where an
 * admin never sees the individual rows, so it may only ever sweep rows the
 * scoring contract already calls publishable.
 */
export class BulkReviewFilterDto {
  @ApiPropertyOptional({ minimum: 2006, maximum: 2030 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2006)
  @Max(2030)
  year?: number;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  subjectCode?: string;

  @ApiProperty({
    description:
      'Required. Must be >= 0.70. Rows with a NULL confidence are never ' +
      'included — an unscored row is not a low-scoring row.',
    minimum: MIN_BULK_CONFIDENCE,
    maximum: 1,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(MIN_BULK_CONFIDENCE)
  @Max(1)
  minConfidence!: number;
}

/**
 * POST /admin/bar-exams/answers/bulk-approve.
 *
 * Exactly one of ``ids`` or ``filter``. Only ``pending`` rows are ever
 * touched, in either mode.
 */
export class BulkApproveBarExamAnswersDto {
  @ApiPropertyOptional({ type: [String], maxItems: 500 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids?: string[];

  @ApiPropertyOptional({ type: BulkReviewFilterDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BulkReviewFilterDto)
  filter?: BulkReviewFilterDto;

  @ApiPropertyOptional({
    description: 'Count the matching rows and write nothing.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({
    description: 'Free-text reason, stored on every audit entry of the batch.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * POST /admin/bar-exams/answers/bulk-reject — explicit ids only.
 *
 * Rejection by filter is deliberately not offered. Approving by filter is at
 * least bounded by a confidence floor the scoring contract already calls
 * publishable; there is no equivalent signal that makes a row safe to reject
 * sight-unseen, and "reject everything at or above 0.70" — the only shape the
 * shared filter could take — is not an operation anyone wants. There is no
 * ``filter`` property here at all, so the global pipe's
 * ``forbidNonWhitelisted`` turns one into a 400 rather than something the
 * service has to remember to refuse.
 */
export class BulkRejectBarExamAnswersDto {
  @ApiProperty({ type: [String], maxItems: 500 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids!: string[];

  @ApiPropertyOptional({
    description: 'Count the matching rows and write nothing.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
