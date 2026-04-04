import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ValidateCouponDto {
  @ApiProperty({ description: 'Coupon code to validate', example: 'LAUNCH2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code!: string;

  @ApiProperty({
    description: 'Plan code the coupon would apply to',
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
}
