import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CheckPromotionEligibilityDto {
  @ApiProperty({ description: 'Plan code to check eligibility for', enum: ['free', 'edu', 'pro', 'team', 'enterprise'] })
  @IsString()
  @IsIn(['free', 'edu', 'pro', 'team', 'enterprise'])
  planCode!: string;

  @ApiProperty({ description: 'Billing period', enum: ['monthly', 'annual'] })
  @IsString()
  @IsIn(['monthly', 'annual'])
  billingPeriod!: string;
}
