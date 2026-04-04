import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class DateRangeQueryDto {
  @ApiPropertyOptional({ description: 'Start date (ISO 8601)', example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (ISO 8601)', example: '2026-03-24' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class TrendQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({
    description: 'Aggregation period',
    enum: ['day', 'week', 'month'],
    default: 'day',
  })
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  period?: string;
}

export class TopItemsQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ description: 'Number of items to return', default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
