import {
  IsString,
  IsArray,
  IsOptional,
  IsInt,
  IsDateString,
  MinLength,
  MaxLength,
  Min,
  Max,
  ArrayMinSize,
} from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  permissions!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  rateLimitPerMinute?: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
