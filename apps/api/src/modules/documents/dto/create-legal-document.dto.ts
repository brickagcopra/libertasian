import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const DOCUMENT_TYPES = [
  'case', 'statute', 'rule', 'issuance', 'memorandum',
  'order', 'digest', 'reviewer', 'user_private_doc',
] as const;

export class CreateLegalDocumentDto {
  @ApiProperty({ description: 'Source registry ID' })
  @IsUUID()
  @IsOptional()
  sourceId?: string;

  @ApiProperty({ enum: DOCUMENT_TYPES })
  @IsString()
  @IsIn(DOCUMENT_TYPES)
  documentType!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  title!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  shortTitle?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  citationText?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(100)
  grNo?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(100)
  docketNo?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  promulgationDate?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  decisionDate?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  publicationDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(255)
  ponente?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(255)
  court?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(255)
  agency?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(50)
  jurisdiction?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(10)
  language?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  canonicalUrl?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(255)
  externalId?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isOfficial?: boolean;
}
