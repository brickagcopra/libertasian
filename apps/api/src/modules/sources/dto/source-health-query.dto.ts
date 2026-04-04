import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class StalenessQueryDto {
  @ApiPropertyOptional({ description: 'Number of days to consider a source stale', default: 30 })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(365)
  @Type(() => Number)
  staleDays?: number;
}
