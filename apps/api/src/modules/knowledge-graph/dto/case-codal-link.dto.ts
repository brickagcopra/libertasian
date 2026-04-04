import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const LINK_TYPES = [
  'interprets',
  'applies',
  'invalidates',
  'modifies',
  'upholds',
  'cites',
] as const;

export class CreateCaseCodalLinkDto {
  @ApiProperty({ description: 'Case decision document ID' })
  @IsUUID()
  caseDocumentId!: string;

  @ApiProperty({ description: 'Codal/statute document ID' })
  @IsUUID()
  codalDocumentId!: string;

  @ApiPropertyOptional({ description: 'Specific codal section ID' })
  @IsOptional()
  @IsUUID()
  codalSectionId?: string;

  @ApiProperty({
    description: 'Relationship type',
    enum: LINK_TYPES,
  })
  @IsString()
  @IsIn(LINK_TYPES)
  linkType!: string;

  @ApiPropertyOptional({ description: 'Notes about this link' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Confidence score (0-1)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;
}

export class UpdateCaseCodalLinkDto {
  @ApiPropertyOptional({
    description: 'Relationship type',
    enum: LINK_TYPES,
  })
  @IsOptional()
  @IsString()
  @IsIn(LINK_TYPES)
  linkType?: string;

  @ApiPropertyOptional({ description: 'Notes about this link' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Confidence score (0-1)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;
}

export class ListCaseCodalLinksQueryDto {
  @ApiPropertyOptional({ description: 'Filter by case document ID' })
  @IsOptional()
  @IsUUID()
  caseDocumentId?: string;

  @ApiPropertyOptional({ description: 'Filter by codal document ID' })
  @IsOptional()
  @IsUUID()
  codalDocumentId?: string;

  @ApiPropertyOptional({ description: 'Filter by link type', enum: LINK_TYPES })
  @IsOptional()
  @IsString()
  @IsIn(LINK_TYPES)
  linkType?: string;

  @ApiPropertyOptional({ description: 'Cursor for pagination' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
