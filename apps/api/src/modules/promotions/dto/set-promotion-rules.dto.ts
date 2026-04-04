import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class PromotionRuleItemDto {
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

  @ApiProperty({ description: 'Rule configuration JSON (varies by ruleType)' })
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

export class SetPromotionRulesDto {
  @ApiProperty({ description: 'Array of promotion rules (replaces all existing rules)', type: [PromotionRuleItemDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PromotionRuleItemDto)
  rules!: PromotionRuleItemDto[];
}
