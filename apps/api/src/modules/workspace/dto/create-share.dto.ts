import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateShareDto {
  @ApiProperty({
    description: 'Type of entity to share',
    enum: ['matter'],
  })
  @IsString()
  @IsNotEmpty()
  @IsEnum(['matter'])
  entityType!: string;

  @ApiProperty({ description: 'ID of the entity to share' })
  @IsUUID()
  entityId!: string;

  @ApiPropertyOptional({
    description: 'Permission level for the share link',
    enum: ['view', 'comment', 'edit'],
    default: 'view',
  })
  @IsOptional()
  @IsString()
  @IsEnum(['view', 'comment', 'edit'])
  permission?: string;

  @ApiPropertyOptional({ description: 'Optional password to protect the share link' })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional({ description: 'Optional label for the share link (e.g. "For client review")' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;

  @ApiPropertyOptional({ description: 'Expiry date for the share link (ISO 8601). Null means no expiry.' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
