import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UpdatePromotionDto {
  @ApiPropertyOptional({ description: 'Display name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'Public description' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ description: 'Internal notes (admin only)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  internalNotes?: string;

  @ApiPropertyOptional({ description: 'Priority (higher = evaluated first)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  priority?: number;

  @ApiPropertyOptional({ description: 'When the promotion starts (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({ description: 'When the promotion ends (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @ApiPropertyOptional({ description: 'Global max redemptions (null = unlimited)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @ApiPropertyOptional({ description: 'Max redemptions per organization' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxRedemptionsPerOrg?: number;

  @ApiPropertyOptional({ description: 'Can stack with coupon codes' })
  @IsOptional()
  @IsBoolean()
  isStackableWithCoupons?: boolean;

  @ApiPropertyOptional({ description: 'Can stack with other promotions' })
  @IsOptional()
  @IsBoolean()
  isStackableWithPromos?: boolean;

  @ApiPropertyOptional({ description: 'Show on public pricing page' })
  @IsOptional()
  @IsBoolean()
  isDisplayedOnPricing?: boolean;

  @ApiPropertyOptional({
    description: 'Status transition (limited: draft→scheduled, scheduled→draft, active→paused, paused→active)',
    enum: ['draft', 'scheduled', 'active', 'paused'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['draft', 'scheduled', 'active', 'paused'])
  status?: string;

  @ApiPropertyOptional({ description: 'Arbitrary metadata JSON' })
  @IsOptional()
  metadataJson?: Record<string, unknown>;
}
