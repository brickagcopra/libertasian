import { IsOptional, IsString, IsIn, IsDateString, IsBoolean, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
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

  /**
   * Skip the Redis read and repopulate the entry from PostgreSQL.
   *
   * Dashboard responses are cached for five minutes with no escape hatch, so a
   * freshly backfilled day stayed invisible for up to that long — an operator
   * re-runs the aggregation, reloads, still sees zeros. It is a read-path
   * bypass only: the fetched value is written back to the same cache key, so it
   * warms the entry everyone else reads rather than forking a second one.
   *
   * `transform: true` is on globally with `enableImplicitConversion: false`, so
   * the string→boolean coercion is explicit here. Only the literal `true` and
   * `1` count; anything else is false, so `?refresh=false` cannot accidentally
   * bypass the cache.
   */
  @ApiPropertyOptional({
    description: 'Bypass the 5-minute response cache and recompute',
    type: Boolean,
  })
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  @IsOptional()
  refresh?: boolean;
}
