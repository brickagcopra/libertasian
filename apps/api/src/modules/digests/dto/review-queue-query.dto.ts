import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

const REVIEW_STATUSES = [
  'draft',
  'ai_generated',
  'needs_human_review',
  'approved',
  'rejected',
] as const;

const SOURCE_ORIGINS = [
  'official_pipeline',
  'admin_generated',
  'user_scan',
  'user_upload',
  'camera_capture',
] as const;

const DIGEST_TYPES = [
  'case_digest',
  'statute_summary',
  'reviewer_note',
  'study_digest',
] as const;

const SORT_FIELDS = ['createdAt', 'confidenceScore', 'updatedAt'] as const;
const SORT_ORDERS = ['asc', 'desc'] as const;

export class ReviewQueueQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination (last digest ID)' })
  @IsUUID()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Number of items per page', default: 20 })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Filter by review statuses (comma-separated)',
    type: [String],
    enum: REVIEW_STATUSES,
  })
  @IsArray()
  @IsString({ each: true })
  @IsIn(REVIEW_STATUSES, { each: true })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  reviewStatus?: string[];

  @ApiPropertyOptional({ description: 'Minimum confidence score (0-1)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  confidenceMin?: number;

  @ApiPropertyOptional({ description: 'Maximum confidence score (0-1)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  confidenceMax?: number;

  @ApiPropertyOptional({
    description: 'Filter by source origin',
    enum: SOURCE_ORIGINS,
  })
  @IsIn([...SOURCE_ORIGINS])
  @IsOptional()
  sourceOrigin?: string;

  @ApiPropertyOptional({
    description: 'Filter by digest type',
    enum: DIGEST_TYPES,
  })
  @IsIn([...DIGEST_TYPES])
  @IsOptional()
  digestType?: string;

  @ApiPropertyOptional({
    description: 'Filter by assigned reviewer (UUID or "unassigned")',
  })
  @IsString()
  @IsOptional()
  assignedTo?: string;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: SORT_FIELDS,
    default: 'createdAt',
  })
  @IsIn([...SORT_FIELDS])
  @IsOptional()
  sortBy?: string;

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: SORT_ORDERS,
    default: 'desc',
  })
  @IsIn([...SORT_ORDERS])
  @IsOptional()
  sortOrder?: string;
}
