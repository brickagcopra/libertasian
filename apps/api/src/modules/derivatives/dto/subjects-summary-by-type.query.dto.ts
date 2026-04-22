import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { DERIVATIVE_TYPES, TAXONOMY_VERSIONS } from './list-derivatives.query.dto';

export class SubjectsSummaryByTypeParamDto {
  @IsIn([...DERIVATIVE_TYPES])
  type!: string;
}

export class SubjectsSummaryByTypeQueryDto {
  @ApiPropertyOptional({
    description: 'Taxonomy version for subject code lookup',
    enum: TAXONOMY_VERSIONS,
    default: 'study_8',
  })
  @IsIn([...TAXONOMY_VERSIONS])
  @IsOptional()
  taxonomyVersion?: string;
}
