import { ArrayUnique, IsArray, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const BACKFILL_MISSING_DERIVATIVE_TYPES = [
  'essay_prompt',
  'mcq_question',
  'flashcard',
] as const;

export type BackfillMissingDerivativeType =
  (typeof BACKFILL_MISSING_DERIVATIVE_TYPES)[number];

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
}
