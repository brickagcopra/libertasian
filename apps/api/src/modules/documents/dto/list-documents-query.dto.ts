import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

const DOCUMENT_TYPES = [
  'case', 'statute', 'rule', 'issuance', 'memorandum',
  'order', 'digest', 'reviewer', 'user_private_doc',
] as const;

const STATUSES = ['draft', 'published', 'unpublished', 'archived'] as const;

export class ListDocumentsQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination (document ID)' })
  @IsUUID()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({ enum: DOCUMENT_TYPES })
  @IsString()
  @IsOptional()
  @IsIn(DOCUMENT_TYPES)
  documentType?: string;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsString()
  @IsOptional()
  @IsIn(STATUSES)
  status?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  court?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  ponente?: string;

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  sourceId?: string;

  @ApiPropertyOptional({ description: 'Filter by G.R. number' })
  @IsString()
  @IsOptional()
  grNo?: string;

  @ApiPropertyOptional({ description: 'Start of decision date range (ISO 8601)' })
  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'End of decision date range (ISO 8601)' })
  @IsDateString()
  @IsOptional()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Search in title' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'Only published documents', default: false })
  @IsOptional()
  publishedOnly?: string;
}
