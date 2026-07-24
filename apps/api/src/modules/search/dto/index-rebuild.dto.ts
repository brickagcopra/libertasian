import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import {
  KEYWORD_INDEX,
  USER_UPLOADS_INDEX,
  VECTOR_INDEX,
} from '../index-mappings';

export class IndexRebuildDto {
  @ApiPropertyOptional({
    description:
      'Build and verify the new physical indices but leave the aliases untouched.',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  dryRun?: boolean;
}

export class IndexRollbackDto {
  @ApiProperty({
    description: 'Alias to repoint',
    enum: [KEYWORD_INDEX, VECTOR_INDEX, USER_UPLOADS_INDEX],
  })
  @IsIn([KEYWORD_INDEX, VECTOR_INDEX, USER_UPLOADS_INDEX])
  alias!: string;

  @ApiProperty({
    description: 'Physical index name to point the alias at (e.g. legal_documents_keyword_v2)',
  })
  @IsString()
  @MaxLength(255)
  // Index names are interpolated into OpenSearch URLs; restrict to the
  // conservative character set our own indices use.
  @Matches(/^[a-z0-9][a-z0-9_-]*$/, {
    message: 'targetIndex must be lowercase alphanumeric with _ or -',
  })
  targetIndex!: string;
}
