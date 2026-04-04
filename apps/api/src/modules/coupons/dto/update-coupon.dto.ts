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

export class UpdateCouponDto {
  @ApiPropertyOptional({ description: 'Display name for the coupon' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

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

  @ApiPropertyOptional({
    description: 'Billing period restriction',
    enum: ['any', 'monthly', 'annual'],
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

  @ApiPropertyOptional({ description: 'Max redemptions per organization' })
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
    description: 'Minimum plan tier required',
    enum: ['free', 'edu', 'pro', 'team', 'enterprise'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['free', 'edu', 'pro', 'team', 'enterprise'])
  minimumPlanTier?: string;

  @ApiPropertyOptional({ description: 'Entitlement key for bonus_credit type' })
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

  @ApiPropertyOptional({ description: 'How many days the bonus lasts' })
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

  @ApiPropertyOptional({ description: 'Active status' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Arbitrary metadata JSON' })
  @IsOptional()
  metadataJson?: Record<string, unknown>;
}
