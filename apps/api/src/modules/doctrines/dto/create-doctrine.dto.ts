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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDoctrineDto {
  @ApiProperty({ description: 'The doctrine text extracted from the document' })
  @IsString()
  @MaxLength(10000)
  text!: string;

  @ApiPropertyOptional({ description: 'Legal document this doctrine was extracted from' })
  @IsUUID()
  @IsOptional()
  legalDocumentId?: string;

  @ApiPropertyOptional({ description: 'Digest this doctrine was extracted from' })
  @IsUUID()
  @IsOptional()
  digestId?: string;

  @ApiPropertyOptional({ description: 'Source section within the legal document' })
  @IsUUID()
  @IsOptional()
  sourceSectionId?: string;

  @ApiPropertyOptional({ description: 'Normalized text for deduplication and matching' })
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

  @ApiPropertyOptional({ description: 'Confidence score (0-1)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  confidence?: number;
}
