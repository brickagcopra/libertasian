import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class BackfillCitationsDto {
  @ApiPropertyOptional({
    description:
      'Cap on dispatched documents in this run. Forwarded as a kwarg to the Celery task.',
    minimum: 1,
    maximum: 10_000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  limit?: number;
}
