import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateShareDto {
  @ApiPropertyOptional({
    description: 'Permission level for the share link',
    enum: ['view', 'comment', 'edit'],
  })
  @IsOptional()
  @IsString()
  @IsEnum(['view', 'comment', 'edit'])
  permission?: string;

  @ApiPropertyOptional({ description: 'Optional label for the share link' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;

  @ApiPropertyOptional({ description: 'New password for the share link (null to remove)' })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional({ description: 'New expiry date (ISO 8601). Null to remove expiry.' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ description: 'Activate or deactivate the share link' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
