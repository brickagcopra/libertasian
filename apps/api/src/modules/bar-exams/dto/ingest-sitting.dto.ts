import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const SLUG_REGEX = /^[a-zA-Z0-9_\-]+$/;

/**
 * One (year, subjectSlug) pair inside the explicit ``sittings`` shape.
 */
export class BarExamSittingRequestDto {
  @ApiProperty({ minimum: 2006, maximum: 2030 })
  @Type(() => Number)
  @IsInt()
  @Min(2006)
  @Max(2030)
  year!: number;

  @ApiProperty({
    description: 'LawPhil subject URL slug (e.g. "civilQ", "remedial-I_Q").',
  })
  @IsString()
  @Matches(SLUG_REGEX)
  subjectSlug!: string;
}

/**
 * Body for ``POST /admin/bar-exams/ingest``. One of three shapes:
 *
 *  1. ``{year, subjectSlug?}`` — single sitting (slug required) OR
 *     single-year backfill (slug omitted).
 *  2. ``{sittings: [{year, subjectSlug}, ...]}`` — explicit list of
 *     sittings, each fanned out as one ``ingest_sitting`` task.
 *  3. ``{backfillAll: true}`` — full archive backfill (worker fans
 *     out and skips already-ingested sittings).
 *
 * Exactly one shape may be set; mixing them is rejected.
 */
export class IngestBarExamDto {
  @ApiPropertyOptional({
    description:
      'Single-sitting / single-year shape — bar exam year. ' +
      'Required when ``subjectSlug`` is provided.',
    minimum: 2006,
    maximum: 2030,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2006)
  @Max(2030)
  year?: number;

  @ApiPropertyOptional({
    description:
      'Single-sitting shape — LawPhil subject URL slug. Requires ' +
      '``year`` to also be set.',
  })
  @IsOptional()
  @IsString()
  @Matches(SLUG_REGEX)
  subjectSlug?: string;

  @ApiPropertyOptional({
    description:
      'Single-year shape — cap on dispatched sittings during the ' +
      'backfill run. Ignored by the explicit-list and full-archive ' +
      'shapes.',
    minimum: 1,
    maximum: 200,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Explicit-list shape — array of (year, subjectSlug) pairs. ' +
      'Each pair is dispatched as one ``ingest_sitting`` task.',
    type: [BarExamSittingRequestDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BarExamSittingRequestDto)
  sittings?: BarExamSittingRequestDto[];

  @ApiPropertyOptional({
    description:
      'Full-archive shape — when ``true`` (and only ``true``), ' +
      'dispatches ``bar_exam.backfill_lawphil_archive`` with no ' +
      'year window. Worker skips already-ingested sittings.',
  })
  @IsOptional()
  @IsBoolean()
  backfillAll?: boolean;
}

export class ReparseBarExamSittingParamDto {
  @ApiProperty({ description: 'UUID of the bar_exam_sittings row to re-parse.' })
  @IsString()
  sittingId!: string;
}
