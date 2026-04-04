import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DowngradePlanDto {
  @ApiProperty({
    description: 'Target plan code to downgrade to (must be lower tier than current)',
    example: 'edu',
    enum: ['free', 'edu', 'pro', 'team'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['free', 'edu', 'pro', 'team'])
  targetPlanCode!: string;

  @ApiPropertyOptional({
    description: 'Billing period for the new plan. Defaults to current billing period.',
    example: 'monthly',
    enum: ['monthly', 'annual'],
  })
  @IsString()
  @IsIn(['monthly', 'annual'])
  @IsOptional()
  billingPeriod?: string;

  @ApiPropertyOptional({
    description: 'Apply downgrade immediately (admin only). Default: false (end of period).',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  immediate?: boolean;
}
