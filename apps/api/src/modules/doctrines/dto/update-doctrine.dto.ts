import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDoctrineDto {
  @ApiPropertyOptional({ description: 'Updated doctrine text' })
  @IsString()
  @IsOptional()
  @MaxLength(10000)
  text?: string;

  @ApiPropertyOptional({ description: 'Updated normalized text' })
  @IsString()
  @IsOptional()
  @MaxLength(10000)
  normalizedText?: string;

  @ApiPropertyOptional({
    description: 'Type of doctrine',
    enum: [
      'ratio_decidendi',
      'obiter_dictum',
      'stare_decisis',
      'statutory_construction',
      'constitutional_interpretation',
      'procedural_rule',
      'evidentiary_rule',
      'other',
    ],
  })
  @IsIn([
    'ratio_decidendi',
    'obiter_dictum',
    'stare_decisis',
    'statutory_construction',
    'constitutional_interpretation',
    'procedural_rule',
    'evidentiary_rule',
    'other',
  ])
  @IsOptional()
  doctrineType?: string;

  @ApiPropertyOptional({ description: 'Source section within the legal document' })
  @IsUUID()
  @IsOptional()
  sourceSectionId?: string;

  @ApiPropertyOptional({ description: 'Confidence score (0-1)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  confidence?: number;

  @ApiPropertyOptional({
    description: 'Review status',
    enum: ['draft', 'ai_generated', 'needs_human_review', 'approved', 'rejected'],
  })
  @IsIn(['draft', 'ai_generated', 'needs_human_review', 'approved', 'rejected'])
  @IsOptional()
  reviewStatus?: string;
}
