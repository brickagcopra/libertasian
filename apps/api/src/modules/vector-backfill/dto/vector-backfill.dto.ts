import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

import {
  VECTOR_BACKFILL_DEFAULT_BATCH_SIZE,
  VECTOR_BACKFILL_MAX_BATCH_SIZE,
  VECTOR_BACKFILL_MAX_DELAY_MS,
} from '../vector-backfill.constants';

export class StartVectorBackfillDto {
  @ApiPropertyOptional({
    description:
      'Enumerate and report the gap without embedding anything. Writes a run ' +
      'and its per-document rows so the estimate is inspectable afterwards.',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  dryRun?: boolean;

  @ApiPropertyOptional({
    description:
      'Restrict the run to these document_type values. Omit for the full ' +
      'priority order (constitution → codal → republic_act → rules_of_court → ' +
      'presidential_decree → executive_order → bar_exam_questions → the rest ' +
      'by recency).',
    type: [String],
  })
  @IsArray()
  @IsOptional()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  // document_type is a VARCHAR(30) of lowercase snake_case values; keep the
  // accepted set narrow rather than passing arbitrary strings into a query.
  @Matches(/^[a-z0-9_]{1,30}$/, { each: true })
  documentTypes?: string[];

  @ApiPropertyOptional({
    description:
      'Texts per embedding request. Measured throughput is 4.8 texts/s on CPU ' +
      '(a batch of 64 took 13.46s) on a box shared with TTS.',
    default: VECTOR_BACKFILL_DEFAULT_BATCH_SIZE,
    minimum: 1,
    maximum: VECTOR_BACKFILL_MAX_BATCH_SIZE,
  })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(VECTOR_BACKFILL_MAX_BATCH_SIZE)
  @Type(() => Number)
  batchSize?: number;

  @ApiPropertyOptional({
    description:
      'Milliseconds to wait between batches. Raise this to yield embedding ' +
      'capacity back to TTS while the backfill runs.',
    default: 0,
    minimum: 0,
    maximum: VECTOR_BACKFILL_MAX_DELAY_MS,
  })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(VECTOR_BACKFILL_MAX_DELAY_MS)
  @Type(() => Number)
  batchDelayMs?: number;

  @ApiPropertyOptional({
    description:
      'Stop after this many documents. Useful for a bounded first run against ' +
      'production before committing to the full ~4.3 hours.',
    minimum: 1,
  })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Type(() => Number)
  maxDocuments?: number;
}

export class VectorBackfillGapQueryDto {
  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsOptional()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^[a-z0-9_]{1,30}$/, { each: true })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  documentTypes?: string[];

  @ApiPropertyOptional({ minimum: 1 })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Type(() => Number)
  maxDocuments?: number;
}

export class ListRunDocumentsQueryDto {
  @ApiPropertyOptional({ enum: ['indexed', 'skipped', 'failed'] })
  @IsIn(['indexed', 'skipped', 'failed'])
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ description: 'Opaque cursor from a previous page.' })
  @IsUUID()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  limit?: number;
}

export class ListVectorBackfillRunsQueryDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;
}
