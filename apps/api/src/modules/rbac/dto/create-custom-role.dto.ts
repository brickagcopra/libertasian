import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCustomRoleDto {
  @ApiProperty({ description: 'Display name for the role', example: 'Senior Paralegal' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    description: 'URL-safe slug (lowercase, hyphens, no spaces)',
    example: 'senior-paralegal',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase alphanumeric with hyphens (e.g. "senior-paralegal")',
  })
  slug!: string;

  @ApiPropertyOptional({ description: 'Role description', example: 'Can review and approve digests' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    description: 'Permission IDs to assign to this role',
    type: [String],
    example: ['uuid-1', 'uuid-2'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  permissionIds!: string[];

  @ApiPropertyOptional({ description: 'Whether MFA is required for this role', default: false })
  @IsOptional()
  @IsBoolean()
  requiresMfa?: boolean;

  @ApiPropertyOptional({
    description: 'Maximum number of members that can hold this role per organization',
    example: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxPerOrg?: number;
}
