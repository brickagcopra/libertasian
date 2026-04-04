import { IsOptional, IsString, IsIn, IsDateString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DashboardQueryDto {
  @ApiPropertyOptional({ description: 'Start date (YYYY-MM-DD)', example: '2026-01-01' })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: 'End date (YYYY-MM-DD)', example: '2026-04-03' })
  @IsDateString()
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({ description: 'Granularity', enum: ['day', 'week', 'month'] })
  @IsIn(['day', 'week', 'month'])
  @IsOptional()
  granularity?: string;

  @ApiPropertyOptional({ description: 'Dimension to group by', enum: ['plan', 'device', 'subject'] })
  @IsIn(['plan', 'device', 'subject'])
  @IsOptional()
  dimension?: string;

  @ApiPropertyOptional({ description: 'Organization ID filter (admin only)' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  organizationId?: string;
}
