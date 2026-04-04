import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';

export class ListCouponsQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination (coupon ID)' })
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

  @ApiPropertyOptional({ description: 'Search by code or name (partial match)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by discount type',
    enum: ['percentage', 'fixed_amount', 'bonus_credit', 'trial_extension'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['percentage', 'fixed_amount', 'bonus_credit', 'trial_extension'])
  discountType?: string;

  @ApiPropertyOptional({ description: 'Filter by active status' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Filter by archived status' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isArchived?: boolean;

  @ApiPropertyOptional({
    description: 'Sort by field',
    enum: ['createdAt', 'code', 'currentRedemptions', 'expiresAt'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsString()
  @IsIn(['createdAt', 'code', 'currentRedemptions', 'expiresAt'])
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
