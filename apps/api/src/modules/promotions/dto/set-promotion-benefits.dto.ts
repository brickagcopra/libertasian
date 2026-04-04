import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class PromotionBenefitItemDto {
  @ApiProperty({
    description: 'Benefit type',
    enum: ['percentage_discount', 'fixed_discount', 'bonus_credit', 'trial_extension'],
  })
  @IsString()
  @IsIn(['percentage_discount', 'fixed_discount', 'bonus_credit', 'trial_extension'])
  benefitType!: string;

  @ApiPropertyOptional({ description: 'Discount value: percentage (1-100) or fixed in centavos' })
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

export class SetPromotionBenefitsDto {
  @ApiProperty({ description: 'Array of promotion benefits (replaces all existing)', type: [PromotionBenefitItemDto] })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PromotionBenefitItemDto)
  benefits!: PromotionBenefitItemDto[];
}
