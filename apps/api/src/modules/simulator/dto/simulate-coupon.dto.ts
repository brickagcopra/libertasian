import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SimulateCouponDto {
  @ApiProperty({
    description: 'Coupon code to simulate',
    example: 'LAUNCH2026',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  couponCode!: string;

  @ApiProperty({
    description: 'Plan code to apply the coupon to',
    example: 'pro',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['free', 'edu', 'pro', 'team', 'enterprise'])
  planCode!: string;

  @ApiProperty({
    description: 'Billing period for pricing calculation',
    enum: ['monthly', 'annual'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['monthly', 'annual'])
  billingPeriod!: string;

  @ApiPropertyOptional({
    description: 'Organization ID for org-specific validation (omit for code-only check)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
