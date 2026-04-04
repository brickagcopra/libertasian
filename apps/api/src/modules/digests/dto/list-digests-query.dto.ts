import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

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
    enum: ['case_digest', 'statute_summary', 'reviewer_note', 'study_digest'],
  })
  @IsIn(['case_digest', 'statute_summary', 'reviewer_note', 'study_digest'])
  @IsOptional()
  digestType?: string;

  @ApiPropertyOptional({
    description: 'Filter by review status',
    enum: ['draft', 'ai_generated', 'needs_human_review', 'approved', 'rejected'],
  })
  @IsIn(['draft', 'ai_generated', 'needs_human_review', 'approved', 'rejected'])
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
