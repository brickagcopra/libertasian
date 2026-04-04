import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDigestDto {
  @ApiPropertyOptional({ description: 'Title of the digest' })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  title?: string;

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
    description: 'Review status',
    enum: ['draft', 'ai_generated', 'needs_human_review', 'approved', 'rejected'],
  })
  @IsIn(['draft', 'ai_generated', 'needs_human_review', 'approved', 'rejected'])
  @IsOptional()
  reviewStatus?: string;

  @ApiPropertyOptional({
    description: 'Visibility level',
    enum: ['private', 'org', 'public_editorial'],
  })
  @IsIn(['private', 'org', 'public_editorial'])
  @IsOptional()
  visibility?: string;
}
