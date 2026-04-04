import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class IngestionTrendsQueryDto {
  @ApiPropertyOptional({
    description: 'Time interval for grouping',
    enum: ['day', 'week', 'month'],
    default: 'day',
  })
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  interval?: 'day' | 'week' | 'month';

  @ApiPropertyOptional({
    description: 'Number of periods to look back (1-365)',
    default: 30,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  @Type(() => Number)
  periods?: number;

  @ApiPropertyOptional({ description: 'Filter by document type' })
  @IsOptional()
  documentType?: string;

  @ApiPropertyOptional({ description: 'Filter by source ID' })
  @IsOptional()
  @IsUUID()
  sourceId?: string;
}
