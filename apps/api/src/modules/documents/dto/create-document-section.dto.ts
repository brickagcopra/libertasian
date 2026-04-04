import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const SECTION_TYPES = [
  'headnote', 'facts', 'issue', 'ruling', 'ratio',
  'dispositive', 'article', 'rule', 'section', 'body',
] as const;

export class CreateDocumentSectionDto {
  @ApiProperty({ enum: SECTION_TYPES })
  @IsString()
  @IsIn(SECTION_TYPES)
  sectionType!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(255)
  sectionLabel?: string;

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  parentSectionId?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  ordering?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  plainText?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  htmlText?: string;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  pageStart?: number;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  pageEnd?: number;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  tokenCount?: number;
}
