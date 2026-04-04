import { IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCheckoutDto {
  @ApiProperty({
    description: 'Plan code to subscribe to',
    enum: ['edu', 'pro', 'team', 'enterprise'],
    example: 'pro',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['edu', 'pro', 'team', 'enterprise'])
  planCode!: string;

  @ApiProperty({
    description: 'Billing period',
    enum: ['monthly', 'annual'],
    example: 'monthly',
  })
  @IsString()
  @IsIn(['monthly', 'annual'])
  billingPeriod!: string;

  @ApiProperty({ description: 'URL to redirect to on successful payment' })
  @IsUrl({ require_tld: false })
  @IsNotEmpty()
  successUrl!: string;

  @ApiProperty({ description: 'URL to redirect to on cancelled payment' })
  @IsUrl({ require_tld: false })
  @IsNotEmpty()
  cancelUrl!: string;

  @ApiPropertyOptional({ description: 'Coupon code to apply at checkout', example: 'LAUNCH20' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  couponCode?: string;

  @ApiPropertyOptional({ description: 'Promotion ID to apply at checkout' })
  @IsOptional()
  @IsUUID()
  promotionId?: string;
}
