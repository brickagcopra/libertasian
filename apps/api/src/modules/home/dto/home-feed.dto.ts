import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

/**
 * Query DTO for GET /home/feed.
 *
 * Cursor pagination: opaque ISO-8601 timestamp of the last forYou item from
 * the previous page. Server filters subsequent pages by `createdAt < cursor`.
 * Cached responses (Redis cache:feed:{userId}, 5-min TTL) only ever hold the
 * first page (no cursor); subsequent pages bypass cache.
 */
export class HomeFeedQueryDto {
  @ApiPropertyOptional({
    description:
      'Opaque cursor (ISO-8601 timestamp from previous page). Omit for first page. ' +
      'Subsequent pages bypass the per-user cache.',
  })
  @IsOptional()
  @IsISO8601()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Number of forYou items per page (1–50)',
    default: 20,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
