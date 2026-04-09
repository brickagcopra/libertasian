import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCreativeDto {
  @IsIn(['modal', 'slide_in', 'floating_bar', 'inline_banner', 'sticky_footer'])
  displayType!: string;

  @IsOptional()
  @IsIn(['bottom_right', 'bottom_left', 'top_right'])
  position?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  headline!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bodyText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  imageAlt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  ctaText?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: 'ctaUrl must be a valid URL with protocol (https://)' })
  @MaxLength(500)
  ctaUrl?: string;

  @IsOptional()
  @IsIn(['primary', 'secondary', 'outline'])
  ctaStyle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  secondaryCtaText?: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'bgColor must be a valid hex color' })
  bgColor?: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'textColor must be a valid hex color' })
  textColor?: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'accentColor must be a valid hex color' })
  accentColor?: string;

  @IsOptional()
  @IsIn(['sm', 'md', 'lg', 'xl', 'full'])
  borderRadius?: string;

  @IsOptional()
  @IsIn(['fade', 'slide_up', 'slide_left', 'bounce', 'none'])
  animation?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  sortOrder?: number;
}
