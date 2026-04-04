import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const TRUST_LEVELS = ['high', 'medium', 'low'] as const;
const FETCH_STRATEGIES = ['crawler', 'manual', 'api', 'upload'] as const;

export class UpdateSourceDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(255)
  domain?: string;

  @ApiPropertyOptional({ enum: TRUST_LEVELS })
  @IsString()
  @IsOptional()
  @IsIn(TRUST_LEVELS)
  trustLevel?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: FETCH_STRATEGIES })
  @IsString()
  @IsOptional()
  @IsIn(FETCH_STRATEGIES)
  fetchStrategy?: string;
}
