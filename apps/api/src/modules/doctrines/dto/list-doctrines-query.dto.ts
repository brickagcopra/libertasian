import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListDoctrinesQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination (last doctrine ID)' })
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

  @ApiPropertyOptional({ description: 'Filter by linked digest' })
  @IsUUID()
  @IsOptional()
  digestId?: string;

  @ApiPropertyOptional({
    description: 'Filter by doctrine type',
    enum: [
      'ratio_decidendi',
      'obiter_dictum',
      'stare_decisis',
      'statutory_construction',
      'constitutional_interpretation',
      'procedural_rule',
      'evidentiary_rule',
      'other',
    ],
  })
  @IsIn([
    'ratio_decidendi',
    'obiter_dictum',
    'stare_decisis',
    'statutory_construction',
    'constitutional_interpretation',
    'procedural_rule',
    'evidentiary_rule',
    'other',
  ])
  @IsOptional()
  doctrineType?: string;

  @ApiPropertyOptional({
    description: 'Filter by review status',
    enum: ['draft', 'ai_generated', 'needs_human_review', 'approved', 'rejected'],
  })
  @IsIn(['draft', 'ai_generated', 'needs_human_review', 'approved', 'rejected'])
  @IsOptional()
  reviewStatus?: string;
}
