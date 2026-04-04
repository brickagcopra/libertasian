import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const SOURCE_TYPES = ['official', 'semi_official', 'editorial', 'user_upload', 'camera_capture'] as const;
const TRUST_LEVELS = ['high', 'medium', 'low'] as const;
const FETCH_STRATEGIES = ['crawler', 'manual', 'api', 'upload'] as const;

export class CreateSourceDto {
  @ApiProperty({ description: 'Source name (e.g., Supreme Court E-Library)' })
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ enum: SOURCE_TYPES })
  @IsString()
  @IsIn(SOURCE_TYPES)
  type!: string;

  @ApiPropertyOptional({ description: 'Domain name of the source (e.g., elibrary.judiciary.gov.ph)' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  domain?: string;

  @ApiPropertyOptional({ enum: TRUST_LEVELS, default: 'medium' })
  @IsString()
  @IsOptional()
  @IsIn(TRUST_LEVELS)
  trustLevel?: string;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: FETCH_STRATEGIES, default: 'crawler' })
  @IsString()
  @IsOptional()
  @IsIn(FETCH_STRATEGIES)
  fetchStrategy?: string;
}
