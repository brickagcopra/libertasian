import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

enum OverrideType {
  BONUS_CREDIT = 'bonus_credit',
  ADMIN_OVERRIDE = 'admin_override',
  PROMO = 'promo',
}

enum SourceType {
  ADMIN = 'admin',
  COUPON = 'coupon',
  PROMOTION = 'promotion',
  SYSTEM = 'system',
}

export class GrantEntitlementOverrideDto {
  @ApiProperty({ description: 'Target organization ID' })
  @IsUUID()
  @IsNotEmpty()
  organizationId!: string;

  @ApiProperty({ description: 'Entitlement key to override (e.g. aiAnswers, digestsPerMonth)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  entitlementKey!: string;

  @ApiProperty({ enum: OverrideType, description: 'Type of override' })
  @IsEnum(OverrideType)
  overrideType!: 'bonus_credit' | 'admin_override' | 'promo';

  @ApiPropertyOptional({ description: 'Numeric value for the override (e.g. 50 extra credits)' })
  @IsOptional()
  @IsInt()
  numericValue?: number;

  @ApiPropertyOptional({ description: 'Boolean value for the override (e.g. enable feature)' })
  @IsOptional()
  @IsBoolean()
  booleanValue?: boolean;

  @ApiProperty({ description: 'Reason for granting the override' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @ApiProperty({ enum: SourceType, description: 'Source of the override' })
  @IsEnum(SourceType)
  sourceType!: 'admin' | 'coupon' | 'promotion' | 'system';

  @ApiPropertyOptional({ description: 'Optional source entity ID (e.g. coupon ID)' })
  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @ApiProperty({ description: 'When the override starts (ISO 8601)' })
  @IsDateString()
  startsAt!: string;

  @ApiPropertyOptional({ description: 'When the override expires (ISO 8601). Null = never expires.' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ description: 'Arbitrary metadata JSON' })
  @IsOptional()
  metadata?: Record<string, unknown>;
}
