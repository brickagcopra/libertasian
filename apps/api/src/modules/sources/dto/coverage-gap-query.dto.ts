import { IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CoverageGapQueryDto {
  @ApiPropertyOptional({
    description: 'Dimension to group coverage gaps by',
    enum: ['documentType', 'court', 'tag', 'barSubject'],
  })
  @IsOptional()
  @IsIn(['documentType', 'court', 'tag', 'barSubject'])
  dimension?: 'documentType' | 'court' | 'tag' | 'barSubject';

  @ApiPropertyOptional({
    description: 'Filter by document publish status',
    enum: ['published', 'draft', 'all'],
    default: 'all',
  })
  @IsOptional()
  @IsIn(['published', 'draft', 'all'])
  status?: 'published' | 'draft' | 'all';

  @ApiPropertyOptional({ description: 'Minimum document count to include in results' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  minDocCount?: number;

  @ApiPropertyOptional({ description: 'Filter from date (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Filter to date (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional({
    description: 'Sort results by field',
    enum: ['gapScore', 'documentCount', 'latestDate'],
    default: 'gapScore',
  })
  @IsOptional()
  @IsIn(['gapScore', 'documentCount', 'latestDate'])
  sortBy?: 'gapScore' | 'documentCount' | 'latestDate';

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';
}
