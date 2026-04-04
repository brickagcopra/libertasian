import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const STATUSES = ['draft', 'published', 'unpublished', 'archived'] as const;
const TRUTHFULNESS_STATUSES = ['verified', 'needs_review', 'quarantined'] as const;

export class UpdateLegalDocumentDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  title?: string;

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

  @ApiPropertyOptional({ enum: STATUSES })
  @IsString()
  @IsOptional()
  @IsIn(STATUSES)
  status?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isOfficial?: boolean;

  @ApiPropertyOptional({ enum: TRUTHFULNESS_STATUSES })
  @IsString()
  @IsOptional()
  @IsIn(TRUTHFULNESS_STATUSES)
  truthfulnessStatus?: string;
}
