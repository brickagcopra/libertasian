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

export class CreateDigestDto {
  @ApiPropertyOptional({ description: 'Legal document this digest is based on' })
  @IsUUID()
  @IsOptional()
  legalDocumentId?: string;

  @ApiProperty({ description: 'Title of the digest' })
  @IsString()
  @MaxLength(1000)
  title!: string;

  @ApiProperty({
    description: 'Origin of the source content',
    enum: ['official_pipeline', 'admin_generated', 'user_scan', 'user_upload', 'camera_capture'],
  })
  @IsIn(['official_pipeline', 'admin_generated', 'user_scan', 'user_upload', 'camera_capture'])
  sourceOrigin!: string;

  @ApiProperty({
    description: 'Type of digest',
    enum: ['case_digest', 'statute_summary', 'reviewer_note', 'study_digest'],
  })
  @IsIn(['case_digest', 'statute_summary', 'reviewer_note', 'study_digest'])
  digestType!: string;

  @ApiPropertyOptional({ description: 'Facts section' })
  @IsString()
  @IsOptional()
  facts?: string;

  @ApiPropertyOptional({ description: 'Issues section' })
  @IsString()
  @IsOptional()
  issues?: string;

  @ApiPropertyOptional({ description: 'Ruling section' })
  @IsString()
  @IsOptional()
  ruling?: string;

  @ApiPropertyOptional({ description: 'Doctrine section' })
  @IsString()
  @IsOptional()
  doctrine?: string;

  @ApiPropertyOptional({ description: 'Dispositive portion' })
  @IsString()
  @IsOptional()
  dispositive?: string;

  @ApiPropertyOptional({ description: 'Summary — one-paragraph overview' })
  @IsString()
  @IsOptional()
  summary?: string;

  @ApiPropertyOptional({ description: "Petitioner's key arguments" })
  @IsString()
  @IsOptional()
  petitionerArguments?: string;

  @ApiPropertyOptional({ description: "Respondent's key arguments" })
  @IsString()
  @IsOptional()
  respondentArguments?: string;

  @ApiPropertyOptional({ description: 'Confidence score (0-1)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  confidenceScore?: number;

  @ApiPropertyOptional({
    description: 'Visibility level',
    enum: ['private', 'org', 'public_editorial'],
    default: 'private',
  })
  @IsIn(['private', 'org', 'public_editorial'])
  @IsOptional()
  visibility?: string;
}
