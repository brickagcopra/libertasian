import { IsDateString, IsNotEmpty, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignRoleDto {
  @ApiProperty({ description: 'Role definition ID to assign', example: 'uuid' })
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'roleDefinitionId must be a valid UUID',
  })
  @IsNotEmpty()
  roleDefinitionId!: string;

  @ApiPropertyOptional({
    description: 'Optional expiry date (ISO 8601)',
    example: '2025-12-31T23:59:59.000Z',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
