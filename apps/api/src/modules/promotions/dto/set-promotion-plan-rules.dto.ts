import { ArrayMaxSize, IsArray, IsIn, IsString, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class PromotionPlanRuleItemDto {
  @ApiProperty({ description: 'Plan code', enum: ['free', 'edu', 'pro', 'team', 'enterprise'] })
  @IsString()
  @IsIn(['free', 'edu', 'pro', 'team', 'enterprise'])
  planCode!: string;

  @ApiProperty({ description: 'Rule type: include or exclude', enum: ['include', 'exclude'] })
  @IsString()
  @IsIn(['include', 'exclude'])
  ruleType!: string;
}

export class SetPromotionPlanRulesDto {
  @ApiProperty({
    description: 'Array of plan rules (replaces all existing rules)',
    type: [PromotionPlanRuleItemDto],
  })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PromotionPlanRuleItemDto)
  rules!: PromotionPlanRuleItemDto[];
}
