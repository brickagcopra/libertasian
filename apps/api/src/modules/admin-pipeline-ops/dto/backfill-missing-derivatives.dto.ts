import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const BACKFILL_MISSING_DERIVATIVE_TYPES = [
  'essay_prompt',
  'mcq_question',
  'flashcard',
] as const;

export type BackfillMissingDerivativeType =
  (typeof BACKFILL_MISSING_DERIVATIVE_TYPES)[number];

export class PerTypeLimitDto {
  @ApiPropertyOptional({
    description: 'Derivative type to enqueue.',
    enum: BACKFILL_MISSING_DERIVATIVE_TYPES,
  })
  @IsIn(BACKFILL_MISSING_DERIVATIVE_TYPES)
  type!: BackfillMissingDerivativeType;

  @ApiPropertyOptional({
    description:
      'Per-type cap on legal_documents scanned for missing artifacts.',
    minimum: 1,
    maximum: 5_000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5_000)
  limit?: number;
}

export class BackfillMissingDerivativesDto {
  @ApiPropertyOptional({
    description:
      'Derivative types to enqueue. Defaults to all three: essay_prompt, mcq_question, flashcard.',
    isArray: true,
    enum: BACKFILL_MISSING_DERIVATIVE_TYPES,
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(BACKFILL_MISSING_DERIVATIVE_TYPES, { each: true })
  types?: BackfillMissingDerivativeType[];

  @ApiPropertyOptional({
    description:
      'Per-type cap on legal_documents scanned for missing artifacts. Default 200.',
    minimum: 1,
    maximum: 5_000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5_000)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Explicit per-type limits. When provided, takes precedence over `types`/`limit` ' +
      'and lets the operator prioritise (e.g. essays first with a higher cap).',
    type: [PerTypeLimitDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PerTypeLimitDto)
  perTypeLimits?: PerTypeLimitDto[];

  @ApiPropertyOptional({
    description:
      'When true, return the same shape as GET /derivatives/backfill-missing/plan ' +
      'without enqueueing any jobs or writing an audit log.',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
