import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export const DERIVATIVE_TYPES = [
  'case_digest',
  'doctrine_extract',
  'mcq_question',
  'essay_prompt',
  'essay_model_answer',
  'suggested_bar_answer',
  'flashcard',
  'subject_outline',
  'sample_pleading',
  'sample_contract',
  'one_page_summary',
] as const;

export const TAXONOMY_VERSIONS = ['study_8', 'bar_admin_6'] as const;

export class ListDerivativesQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination (last artifact ID)' })
  @IsUUID()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Number of items per page', default: 20 })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Subject code to filter by (e.g., "political_law")',
  })
  @IsString()
  @IsOptional()
  @MaxLength(40)
  subjectCode?: string;

  @ApiPropertyOptional({
    description: 'Derivative type filter',
    enum: DERIVATIVE_TYPES,
  })
  @IsIn([...DERIVATIVE_TYPES])
  @IsOptional()
  derivativeType?: string;

  @ApiPropertyOptional({
    description: 'Taxonomy version for subject code lookup',
    enum: TAXONOMY_VERSIONS,
    default: 'study_8',
  })
  @IsIn([...TAXONOMY_VERSIONS])
  @IsOptional()
  taxonomyVersion?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive title search' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  search?: string;
}
