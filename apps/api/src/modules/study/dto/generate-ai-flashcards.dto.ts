import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class GenerateAiFlashcardsDto {
  @ApiProperty({
    description: 'Topic for flashcard generation (5-1000 characters)',
    example: 'Doctrine of last clear chance in Philippine tort law',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  topic!: string;

  @ApiPropertyOptional({
    description: 'Type of flashcards to generate',
    enum: [
      'definition',
      'application',
      'case_holding',
      'provision',
      'doctrine',
      'procedure',
      'mixed',
    ],
    default: 'mixed',
  })
  @IsIn([
    'definition',
    'application',
    'case_holding',
    'provision',
    'doctrine',
    'procedure',
    'mixed',
  ])
  @IsOptional()
  cardType?: string;

  @ApiPropertyOptional({
    description: 'Number of flashcards to generate (1-30)',
    default: 10,
  })
  @IsInt()
  @Min(1)
  @Max(30)
  @IsOptional()
  @Type(() => Number)
  count?: number;

  @ApiPropertyOptional({
    description: 'Bar subject filter for context retrieval',
    example: 'civil_law',
  })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  barSubject?: string;

  @ApiPropertyOptional({
    description: 'Specific document IDs to use as context (max 10)',
    type: [String],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  contextDocumentIds?: string[];
}
