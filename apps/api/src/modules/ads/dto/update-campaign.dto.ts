import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsIn(['draft', 'active', 'paused', 'ended'])
  status?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetPages?: string[];

  @IsOptional()
  @IsIn(['free', 'authenticated', 'anonymous'])
  targetUserType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxImpressions?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxImpressionsPerUser?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  showAfterSeconds?: number;

  @IsOptional()
  @IsBoolean()
  showOncePerSession?: boolean;
}

export class UpdateCampaignStatusDto {
  @IsIn(['active', 'paused', 'ended'])
  status!: string;
}
