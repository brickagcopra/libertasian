import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SimulatePricingDto {
  @ApiProperty({
    description: 'Organization ID to simulate pricing for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsNotEmpty()
  organizationId!: string;

  @ApiProperty({
    description: 'Plan code to simulate',
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

  @ApiPropertyOptional({
    description: 'Coupon code to apply',
    example: 'LAUNCH2026',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  couponCode?: string;

  @ApiPropertyOptional({
    description: 'Promotion ID to apply',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsOptional()
  @IsUUID()
  promotionId?: string;
}
