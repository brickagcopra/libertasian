import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body for ``POST /admin/bar-exams/ingest``. ``year`` alone dispatches a
 * single-year backfill; ``year`` + ``subjectSlug`` dispatches one sitting;
 * neither (year/subjectSlug both unset) dispatches the full archive backfill.
 */
export class IngestBarExamDto {
  @ApiPropertyOptional({
    description:
      'Bar exam year. Required when ``subjectSlug`` is provided; ' +
      'optional alone (caps the backfill year window).',
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
      'LawPhil subject URL slug (e.g. "civilQ", "remedial-I_Q"). ' +
      'When set, ``year`` must also be set; the task dispatches one ' +
      'specific sitting instead of a backfill range.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_\-]+$/)
  subjectSlug?: string;

  @ApiPropertyOptional({
    description: 'Cap on dispatched sittings during a backfill run.',
    minimum: 1,
    maximum: 200,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ReparseBarExamSittingParamDto {
  @ApiProperty({ description: 'UUID of the bar_exam_sittings row to re-parse.' })
  @IsString()
  sittingId!: string;
}
