import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpgradePlanDto {
  @ApiProperty({
    description: 'Target plan code to upgrade to (must be higher tier than current)',
    example: 'team',
    enum: ['edu', 'pro', 'team', 'enterprise'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['edu', 'pro', 'team', 'enterprise'])
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
}
