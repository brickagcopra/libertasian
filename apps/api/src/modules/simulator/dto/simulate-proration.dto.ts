import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SimulateProrationDto {
  @ApiProperty({
    description: 'Current plan code',
    example: 'pro',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['free', 'edu', 'pro', 'team', 'enterprise'])
  currentPlanCode!: string;

  @ApiProperty({
    description: 'Target plan code to prorate to',
    example: 'team',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['free', 'edu', 'pro', 'team', 'enterprise'])
  newPlanCode!: string;

  @ApiProperty({
    description: 'Billing period',
    enum: ['monthly', 'annual'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['monthly', 'annual'])
  billingPeriod!: string;

  @ApiProperty({
    description: 'Current billing period start date (ISO 8601)',
    example: '2026-03-01T00:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  periodStart!: string;

  @ApiProperty({
    description: 'Current billing period end date (ISO 8601)',
    example: '2026-04-01T00:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  periodEnd!: string;

  @ApiPropertyOptional({
    description: 'Effective date for the proration (defaults to now)',
    example: '2026-03-15T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;
}
