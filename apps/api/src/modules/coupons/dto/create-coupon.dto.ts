import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateCouponDto {
  @ApiProperty({ description: 'Unique coupon code (auto-uppercased, max 50 chars)', example: 'LAUNCH2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code!: string;

  @ApiProperty({ description: 'Display name for the coupon', example: 'Launch Day 20% Off' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ description: 'Public description (shown to users)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ description: 'Internal notes (admin only)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  internalNotes?: string;

  @ApiProperty({
    description: 'Discount type',
    enum: ['percentage', 'fixed_amount', 'bonus_credit', 'trial_extension'],
  })
  @IsString()
  @IsIn(['percentage', 'fixed_amount', 'bonus_credit', 'trial_extension'])
  discountType!: string;

  @ApiProperty({
    description: 'Discount value: percentage (1-100), fixed_amount (centavos), bonus qty, or trial days',
    example: 20,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  discountValue!: number;

  @ApiPropertyOptional({ description: 'Currency code (default: PHP)', default: 'PHP' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({
    description: 'Billing period restriction',
    enum: ['any', 'monthly', 'annual'],
    default: 'any',
  })
  @IsOptional()
  @IsString()
  @IsIn(['any', 'monthly', 'annual'])
  appliesToBillingPeriod?: string;

  @ApiPropertyOptional({ description: 'Global max redemption count (null = unlimited)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @ApiPropertyOptional({ description: 'Max redemptions per organization (default: 1)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxRedemptionsPerOrg?: number;

  @ApiPropertyOptional({ description: 'When the coupon becomes valid (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({ description: 'When the coupon expires (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({
    description: 'Minimum plan tier required to use this coupon',
    enum: ['free', 'edu', 'pro', 'team', 'enterprise'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['free', 'edu', 'pro', 'team', 'enterprise'])
  minimumPlanTier?: string;

  @ApiPropertyOptional({ description: 'Entitlement key for bonus_credit type (e.g. aiAnswers)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bonusEntitlementKey?: string;

  @ApiPropertyOptional({ description: 'Bonus quantity for bonus_credit type' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bonusEntitlementValue?: number;

  @ApiPropertyOptional({ description: 'How many days the bonus lasts (null = permanent)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  bonusDurationDays?: number;

  @ApiPropertyOptional({ description: 'Trial extension days for trial_extension type' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  trialExtensionDays?: number;

  @ApiPropertyOptional({ description: 'Start as active (default: true)', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Arbitrary metadata JSON' })
  @IsOptional()
  metadataJson?: Record<string, unknown>;
}
