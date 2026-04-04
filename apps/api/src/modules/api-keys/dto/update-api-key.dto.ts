import {
  IsString,
  IsArray,
  IsOptional,
  IsInt,
  IsBoolean,
  IsDateString,
  MinLength,
  MaxLength,
  Min,
  Max,
  ArrayMinSize,
} from 'class-validator';

export class UpdateApiKeyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  permissions?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  rateLimitPerMinute?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;
}
