import {
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class CreatePromotionRuleItemDto {
  @ApiProperty({
    description: 'Rule type',
    enum: [
      'date_range',
      'organization_type',
      'subscription_status',
      'redemption_limit',
      'new_subscriber',
      'billing_period',
      'minimum_tier',
      'stacking',
    ],
  })
  @IsString()
  @IsIn([
    'date_range',
    'organization_type',
    'subscription_status',
    'redemption_limit',
    'new_subscriber',
    'billing_period',
    'minimum_tier',
    'stacking',
  ])
  ruleType!: string;

  @ApiProperty({ description: 'Rule configuration JSON' })
  configuration!: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Evaluation order (lower = first)', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ordering?: number;

  @ApiPropertyOptional({ description: 'Whether the rule is active', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class CreatePromotionBenefitItemDto {
  @ApiProperty({
    description: 'Benefit type',
    enum: ['percentage_discount', 'fixed_discount', 'bonus_credit', 'trial_extension'],
  })
  @IsString()
  @IsIn(['percentage_discount', 'fixed_discount', 'bonus_credit', 'trial_extension'])
  benefitType!: string;

  @ApiPropertyOptional({
    description: 'Discount value: percentage (1-100) or fixed amount in centavos',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  discountValue?: number;

  @ApiPropertyOptional({ description: 'Entitlement key for bonus_credit (e.g. aiAnswers)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bonusEntitlementKey?: string;

  @ApiPropertyOptional({ description: 'Bonus quantity for bonus_credit' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bonusEntitlementValue?: number;

  @ApiPropertyOptional({ description: 'Bonus duration in days (null = permanent)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  bonusDurationDays?: number;

  @ApiPropertyOptional({ description: 'Trial extension days' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  trialExtensionDays?: number;

  @ApiPropertyOptional({
    description: 'Billing period this benefit applies to',
    enum: ['any', 'monthly', 'annual'],
    default: 'any',
  })
  @IsOptional()
  @IsString()
  @IsIn(['any', 'monthly', 'annual'])
  appliesToBillingPeriod?: string;
}

export class CreatePromotionDto {
  @ApiProperty({ description: 'Display name', example: 'Summer Sale 2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ description: 'URL-safe slug (unique)', example: 'summer-sale-2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  slug!: string;

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
    description: 'Promotion type',
    enum: ['sale', 'bonus', 'trial_extension', 'combined'],
  })
  @IsString()
  @IsIn(['sale', 'bonus', 'trial_extension', 'combined'])
  promotionType!: string;

  @ApiPropertyOptional({
    description: 'Initial status (default: draft)',
    enum: ['draft', 'scheduled', 'active'],
    default: 'draft',
  })
  @IsOptional()
  @IsString()
  @IsIn(['draft', 'scheduled', 'active'])
  status?: string;

  @ApiPropertyOptional({ description: 'Priority (higher = evaluated first)', default: 0 })
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

  @ApiPropertyOptional({ description: 'Max redemptions per organization (default: 1)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxRedemptionsPerOrg?: number;

  @ApiPropertyOptional({ description: 'Can stack with coupon codes', default: false })
  @IsOptional()
  @IsBoolean()
  isStackableWithCoupons?: boolean;

  @ApiPropertyOptional({ description: 'Can stack with other promotions', default: false })
  @IsOptional()
  @IsBoolean()
  isStackableWithPromos?: boolean;

  @ApiPropertyOptional({ description: 'Show on public pricing page', default: false })
  @IsOptional()
  @IsBoolean()
  isDisplayedOnPricing?: boolean;

  @ApiPropertyOptional({ description: 'Promotion rules (eligibility conditions)', type: [CreatePromotionRuleItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePromotionRuleItemDto)
  rules?: CreatePromotionRuleItemDto[];

  @ApiPropertyOptional({ description: 'Promotion benefits (discounts/bonuses)', type: [CreatePromotionBenefitItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePromotionBenefitItemDto)
  benefits?: CreatePromotionBenefitItemDto[];

  @ApiPropertyOptional({ description: 'Arbitrary metadata JSON' })
  @IsOptional()
  metadataJson?: Record<string, unknown>;
}
