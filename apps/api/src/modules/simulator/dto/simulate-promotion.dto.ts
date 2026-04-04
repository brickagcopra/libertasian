import { IsIn, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SimulatePromotionDto {
  @ApiProperty({
    description: 'Promotion ID to evaluate',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsUUID()
  @IsNotEmpty()
  promotionId!: string;

  @ApiProperty({
    description: 'Organization ID to evaluate eligibility for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsNotEmpty()
  organizationId!: string;

  @ApiProperty({
    description: 'Plan code to evaluate against',
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
