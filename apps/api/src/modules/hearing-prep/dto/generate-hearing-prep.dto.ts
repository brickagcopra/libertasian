import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateHearingPrepDto {
  @ApiProperty({
    description: 'Topic for the hearing preparation (5-500 characters)',
    minLength: 5,
    maxLength: 500,
  })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  topic!: string;

  @ApiPropertyOptional({
    description: 'Specific legal issue to focus on (5-2000 characters)',
    minLength: 5,
    maxLength: 2000,
  })
  @IsString()
  @IsOptional()
  @MinLength(5)
  @MaxLength(2000)
  issue?: string;

  @ApiPropertyOptional({
    description: 'UUIDs of legal documents to include (max 10). Can be empty for topic-based search.',
    type: [String],
  })
  @IsArray()
  @IsOptional()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  documentIds?: string[];

  @ApiPropertyOptional({
    description: 'Additional context for the hearing prep generation',
    type: Object,
  })
  @IsObject()
  @IsOptional()
  inputContext?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Link hearing prep to a specific matter' })
  @IsUUID()
  @IsOptional()
  matterId?: string;
}
