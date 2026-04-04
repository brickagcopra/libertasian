import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PreviewCheckoutDto {
  @ApiProperty({
    description: 'Plan code to preview pricing for',
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

  @ApiPropertyOptional({ description: 'Coupon code to preview discount', example: 'LAUNCH20' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  couponCode?: string;

  @ApiPropertyOptional({ description: 'Promotion ID to preview discount' })
  @IsOptional()
  @IsUUID()
  promotionId?: string;
}
