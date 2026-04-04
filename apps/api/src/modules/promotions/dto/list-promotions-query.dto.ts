import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';

export class ListPromotionsQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination (promotion ID)' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Page size (default: 20, max: 100)', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Search by name or slug (partial match)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by status',
    enum: ['draft', 'scheduled', 'active', 'paused', 'expired', 'archived'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['draft', 'scheduled', 'active', 'paused', 'expired', 'archived'])
  status?: string;

  @ApiPropertyOptional({
    description: 'Filter by promotion type',
    enum: ['sale', 'bonus', 'trial_extension', 'combined'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['sale', 'bonus', 'trial_extension', 'combined'])
  promotionType?: string;

  @ApiPropertyOptional({ description: 'Filter by displayed on pricing page' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isDisplayedOnPricing?: boolean;

  @ApiPropertyOptional({
    description: 'Sort by field',
    enum: ['createdAt', 'name', 'priority', 'currentRedemptions', 'startsAt', 'endsAt'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsString()
  @IsIn(['createdAt', 'name', 'priority', 'currentRedemptions', 'startsAt', 'endsAt'])
  sortBy?: string;

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  sortDir?: string;
}
