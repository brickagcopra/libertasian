import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GrantComplimentaryDto {
  @ApiProperty({
    description: 'Organization to grant complimentary access to',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsNotEmpty()
  organizationId!: string;

  @ApiProperty({
    description: 'Plan code for complimentary access',
    example: 'pro',
    enum: ['edu', 'pro', 'team', 'enterprise'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['edu', 'pro', 'team', 'enterprise'])
  planCode!: string;

  @ApiProperty({
    description: 'Reason for granting complimentary access',
    example: 'Partner organization — beta tester',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({
    description: 'End date for complimentary access (ISO 8601). Omit for indefinite.',
    example: '2026-12-31T23:59:59.000Z',
  })
  @IsDateString()
  @IsOptional()
  endsAt?: string;
}
