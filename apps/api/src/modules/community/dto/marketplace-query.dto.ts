import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class MarketplaceQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination' })
  @IsUUID()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({ description: 'Filter by bar subject code' })
  @IsString()
  @IsOptional()
  barSubject?: string;

  @ApiPropertyOptional({ description: 'Search by title keyword' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['newest', 'top_rated', 'most_reviewed', 'trending'],
    default: 'top_rated',
  })
  @IsIn(['newest', 'top_rated', 'most_reviewed', 'trending'])
  @IsOptional()
  sortBy?: string;
}
