import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** POST /platform/staff/:userId/roles */
export class GrantPlatformRoleDto {
  @ApiProperty({ description: 'Role definition ID to grant (platform-scope or system)' })
  @IsUUID('4')
  @IsNotEmpty()
  roleDefinitionId!: string;

  @ApiPropertyOptional({
    description: 'Optional expiry (ISO 8601). After this the grant confers nothing.',
    example: '2026-12-31T23:59:59.000Z',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

/** GET /platform/staff */
export class ListPlatformStaffQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination (grant ID)' })
  @IsOptional()
  @IsUUID('4')
  cursor?: string;

  @ApiPropertyOptional({ description: 'Items per page', default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** GET /platform/staff/candidates */
export class SearchStaffCandidatesQueryDto {
  @ApiProperty({ description: 'Email or name fragment (existing accounts only)', example: 'jane' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  q!: string;

  @ApiPropertyOptional({ description: 'Max results', default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

/** POST /platform/roles */
export class CreatePlatformRoleDto {
  @ApiProperty({ description: 'Display name', example: 'Corpus Reviewer' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ description: 'URL-safe slug', example: 'corpus-reviewer' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase alphanumeric with hyphens (e.g. "corpus-reviewer")',
  })
  slug!: string;

  @ApiPropertyOptional({ description: 'What this role is for' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ description: 'Permission IDs this role confers', type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true, message: 'each permissionId must be a valid UUID' })
  permissionIds!: string[];

  @ApiPropertyOptional({ description: 'Require MFA of holders', default: false })
  @IsOptional()
  @IsBoolean()
  requiresMfa?: boolean;

  @ApiPropertyOptional({
    description:
      'Maximum simultaneous PLATFORM holders (stored in role_definitions.max_per_org)',
    example: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxPerOrg?: number;
}

/** PATCH /platform/roles/:id */
export class UpdatePlatformRoleDto {
  @ApiPropertyOptional({ description: 'Display name' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'What this role is for' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Replacement permission ID set', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true, message: 'each permissionId must be a valid UUID' })
  permissionIds?: string[];

  @ApiPropertyOptional({ description: 'Require MFA of holders' })
  @IsOptional()
  @IsBoolean()
  requiresMfa?: boolean;

  @ApiPropertyOptional({ description: 'Maximum simultaneous PLATFORM holders' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxPerOrg?: number;
}
