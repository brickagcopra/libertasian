import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCustomRoleDto {
  @ApiPropertyOptional({ description: 'Display name for the role', example: 'Lead Paralegal' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Role description' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description: 'Replace all permissions with these IDs',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    each: true,
    message: 'each permissionId must be a valid UUID',
  })
  permissionIds?: string[];

  @ApiPropertyOptional({ description: 'Whether MFA is required for this role' })
  @IsOptional()
  @IsBoolean()
  requiresMfa?: boolean;

  @ApiPropertyOptional({ description: 'Max members per org that can hold this role' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxPerOrg?: number;
}
