import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SimulateTransitionDto {
  @ApiProperty({
    description: 'Current subscription state (e.g. "active", "trialing")',
    example: 'active',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  currentState!: string;

  @ApiProperty({
    description: 'Action to simulate (e.g. "UPGRADE", "REQUEST_CANCEL")',
    example: 'REQUEST_CANCEL',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  action!: string;

  @ApiPropertyOptional({
    description: 'Plan code context for the transition (informational)',
    example: 'pro',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  planCode?: string;

  @ApiPropertyOptional({
    description: 'Actor type performing the action',
    example: 'admin',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  actorType?: string;
}
