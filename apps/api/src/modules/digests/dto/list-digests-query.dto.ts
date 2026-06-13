import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

// Local mirror of the digests filter contract from @libertasian/types. This is
// deliberately NOT imported from the package at runtime: the types package dist/
// is not built in Dockerfile.api, so a runtime import would crash the API at boot.
// The mirror is CI-locked to the shared arrays by list-digests-query.dto.spec.ts.
export const DIGEST_TYPE_VALUES = [
  'case_digest',
  'statute_summary',
  'reviewer_note',
  'study_digest',
] as const;

export const REVIEW_STATUS_VALUES = [
  'draft',
  'ai_generated',
  'needs_human_review',
  'approved',
  'rejected',
] as const;

export class ListDigestsQueryDto {
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

  @ApiPropertyOptional({ description: 'Filter by linked legal document' })
  @IsUUID()
  @IsOptional()
  legalDocumentId?: string;

  @ApiPropertyOptional({
    description: 'Filter by digest type',
    enum: [...DIGEST_TYPE_VALUES],
  })
  @IsIn([...DIGEST_TYPE_VALUES])
  @IsOptional()
  digestType?: string;

  @ApiPropertyOptional({
    description: 'Filter by review status',
    enum: [...REVIEW_STATUS_VALUES],
  })
  @IsIn([...REVIEW_STATUS_VALUES])
  @IsOptional()
  reviewStatus?: string;

  @ApiPropertyOptional({
    description: 'Filter by source origin',
    enum: ['official_pipeline', 'admin_generated', 'user_scan', 'user_upload', 'camera_capture'],
  })
  @IsIn(['official_pipeline', 'admin_generated', 'user_scan', 'user_upload', 'camera_capture'])
  @IsOptional()
  sourceOrigin?: string;

  @ApiPropertyOptional({
    description: 'Filter by visibility',
    enum: ['private', 'org', 'public_editorial'],
  })
  @IsIn(['private', 'org', 'public_editorial'])
  @IsOptional()
  visibility?: string;
}
