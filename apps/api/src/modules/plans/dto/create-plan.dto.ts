import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePlanDto {
  @ApiProperty({ description: 'Unique plan code (e.g., free, edu, pro)', example: 'pro' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code!: string;

  @ApiProperty({ description: 'Internal plan name', example: 'Pro Plan' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ description: 'Display name shown to users', example: 'Professional' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  displayName?: string;

  @ApiPropertyOptional({ description: 'Plan description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Plan type',
    enum: ['standard', 'trial', 'complimentary', 'custom'],
    example: 'standard',
  })
  @IsString()
  @IsEnum(['standard', 'trial', 'complimentary', 'custom'])
  type!: string;

  @ApiPropertyOptional({
    description: 'Plan category',
    enum: ['individual', 'team', 'academic', 'enterprise'],
    example: 'individual',
  })
  @IsString()
  @IsOptional()
  @IsEnum(['individual', 'team', 'academic', 'enterprise'])
  category?: string;

  @ApiPropertyOptional({ description: 'Whether the plan is active', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Whether the plan is visible on the pricing page', default: true })
  @IsBoolean()
  @IsOptional()
  isVisible?: boolean;

  @ApiPropertyOptional({ description: 'Display order for sorting', default: 0, example: 10 })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(9999)
  displayOrder?: number;

  @ApiPropertyOptional({ description: 'Whether trial is enabled for this plan', default: false })
  @IsBoolean()
  @IsOptional()
  trialEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Trial duration in days', example: 14 })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(365)
  trialDurationDays?: number;

  @ApiPropertyOptional({ description: 'Grace period in days after payment failure', example: 7 })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(90)
  gracePeriodDays?: number;

  @ApiPropertyOptional({ description: 'Whether auto-renewal is required', default: true })
  @IsBoolean()
  @IsOptional()
  autoRenewRequired?: boolean;

  @ApiPropertyOptional({ description: 'Only admins can assign this plan', default: false })
  @IsBoolean()
  @IsOptional()
  adminOnlyAssignment?: boolean;

  @ApiPropertyOptional({ description: 'Invite-only plan', default: false })
  @IsBoolean()
  @IsOptional()
  inviteOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Eligible segments (org types)',
    example: ['solo_lawyer', 'firm'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  eligibleSegments?: string[];

  @ApiPropertyOptional({ description: 'Maximum seats allowed', example: 10 })
  @IsInt()
  @IsOptional()
  @Min(1)
  maxSeats?: number;

  @ApiPropertyOptional({ description: 'Internal notes (admin only)' })
  @IsString()
  @IsOptional()
  internalNotes?: string;

  @ApiPropertyOptional({ description: 'Whether this plan is featured on the pricing page', default: false })
  @IsBoolean()
  @IsOptional()
  isFeatured?: boolean;

  @ApiPropertyOptional({ description: 'Badge label when featured (e.g. "Most Popular")', example: 'Most Popular' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  featuredLabel?: string;

  @ApiPropertyOptional({ description: 'Custom CTA button text (e.g. "Start Now")', example: 'Start Now' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  ctaText?: string;

  @ApiPropertyOptional({ description: 'Highlight color theme for the plan card', example: 'primary' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  highlightColor?: string;
}
