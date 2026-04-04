import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class CouponPlanRuleItemDto {
  @ApiProperty({ description: 'Plan code', example: 'pro' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  planCode!: string;

  @ApiProperty({ description: 'Rule type', enum: ['include', 'exclude'] })
  @IsString()
  @IsIn(['include', 'exclude'])
  ruleType!: string;
}

export class SetCouponPlanRulesDto {
  @ApiProperty({
    description: 'Array of plan rules (replaces all existing rules for this coupon)',
    type: [CouponPlanRuleItemDto],
  })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CouponPlanRuleItemDto)
  rules!: CouponPlanRuleItemDto[];
}
