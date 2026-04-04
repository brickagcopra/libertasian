import { IsInt, IsISO8601, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class SearchUploadsDto {
  @ApiProperty({ description: 'Full-text search query' })
  @IsString()
  @MinLength(1)
  query!: string;

  @ApiPropertyOptional({ description: 'Filter by classified document type' })
  @IsOptional()
  @IsString()
  documentType?: string;

  @ApiPropertyOptional({ description: 'Filter from date (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Filter to date (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ description: 'Results per page (max 100)', default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;
}
