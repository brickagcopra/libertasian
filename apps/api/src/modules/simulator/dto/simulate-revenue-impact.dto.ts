import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RevenueImpactPlanInput {
  @ApiProperty({
    description: 'Plan code',
    example: 'pro',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['free', 'edu', 'pro', 'team', 'enterprise'])
  planCode!: string;

  @ApiProperty({
    description: 'Billing period',
    enum: ['monthly', 'annual'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['monthly', 'annual'])
  billingPeriod!: string;
}

export class SimulateRevenueImpactDto {
  @ApiPropertyOptional({
    description: 'Coupon ID to analyze (provide exactly one of couponId or promotionId)',
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  @IsOptional()
  @IsUUID()
  couponId?: string;

  @ApiPropertyOptional({
    description: 'Promotion ID to analyze (provide exactly one of couponId or promotionId)',
    example: '550e8400-e29b-41d4-a716-446655440003',
  })
  @IsOptional()
  @IsUUID()
  promotionId?: string;

  @ApiProperty({
    description: 'List of plan + billing period combos to analyze',
    type: [RevenueImpactPlanInput],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RevenueImpactPlanInput)
  plans!: RevenueImpactPlanInput[];
}
