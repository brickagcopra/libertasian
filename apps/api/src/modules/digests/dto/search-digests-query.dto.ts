import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { TAXONOMY_VERSION_VALUES } from './list-digests-query.dto';

export class SearchDigestsQueryDto {
  @ApiPropertyOptional({ description: 'Free-text search (title, case name, citation)' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Cursor (digest id) for pagination' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Page size (max 50)', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Subject code to filter by (e.g., "political_law")',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  subjectCode?: string;

  @ApiPropertyOptional({
    description: 'Taxonomy version for subject code lookup',
    enum: [...TAXONOMY_VERSION_VALUES],
    default: 'study_8',
  })
  @IsOptional()
  @IsIn([...TAXONOMY_VERSION_VALUES])
  taxonomyVersion?: string;
}
