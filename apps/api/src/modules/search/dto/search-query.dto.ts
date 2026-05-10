import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';

export class SearchQueryDto {
  @ApiProperty({ description: 'Search query string' })
  @IsString()
  @MaxLength(1000)
  query!: string;

  @ApiPropertyOptional({
    description: 'Filter by document class',
    enum: ['case', 'statute', 'codal', 'article', 'outline'],
  })
  @IsIn(['case', 'statute', 'codal', 'article', 'outline'])
  @IsOptional()
  documentType?: string;

  @ApiPropertyOptional({ description: 'Filter by court' })
  @IsString()
  @IsOptional()
  court?: string;

  @ApiPropertyOptional({ description: 'Filter by ponente' })
  @IsString()
  @IsOptional()
  ponente?: string;

  @ApiPropertyOptional({ description: 'Filter by source ID' })
  @IsUUID()
  @IsOptional()
  sourceId?: string;

  @ApiPropertyOptional({ description: 'Filter by G.R. Number' })
  @IsString()
  @IsOptional()
  grNo?: string;

  @ApiPropertyOptional({ description: 'Filter by decision date from (YYYY-MM-DD)' })
  @IsString()
  @IsOptional()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Filter by decision date to (YYYY-MM-DD)' })
  @IsString()
  @IsOptional()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Only show published documents' })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  publishedOnly?: boolean;

  @ApiPropertyOptional({ description: 'Page number (0-based)', default: 0 })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ description: 'Results per page', default: 20 })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Answer mode for AI-powered results',
    enum: ['search', 'alac', 'irac', 'concise', 'free_form'],
    default: 'search',
  })
  @IsIn(['search', 'alac', 'irac', 'concise', 'free_form'])
  @IsOptional()
  mode?: string;
}
