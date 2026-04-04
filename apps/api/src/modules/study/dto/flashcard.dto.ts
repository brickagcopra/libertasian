import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateFlashcardDto {
  @ApiProperty({ description: 'Front side of the flashcard (question)' })
  @IsString()
  front!: string;

  @ApiProperty({ description: 'Back side of the flashcard (answer)' })
  @IsString()
  back!: string;

  @ApiPropertyOptional({ description: 'Legal document reference' })
  @IsUUID()
  @IsOptional()
  legalDocumentId?: string;

  @ApiPropertyOptional({ description: 'Section reference' })
  @IsUUID()
  @IsOptional()
  sectionId?: string;

  @ApiPropertyOptional({ description: 'Digest reference' })
  @IsUUID()
  @IsOptional()
  digestId?: string;

  @ApiPropertyOptional({
    description: 'Source type',
    enum: ['manual', 'ai_generated', 'from_digest', 'from_provision'],
    default: 'manual',
  })
  @IsIn(['manual', 'ai_generated', 'from_digest', 'from_provision'])
  @IsOptional()
  sourceType?: string;

  @ApiPropertyOptional({ description: 'Ordering within the set', default: 0 })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  ordering?: number;
}

export class UpdateFlashcardDto {
  @ApiPropertyOptional({ description: 'Front side of the flashcard' })
  @IsString()
  @IsOptional()
  front?: string;

  @ApiPropertyOptional({ description: 'Back side of the flashcard' })
  @IsString()
  @IsOptional()
  back?: string;

  @ApiPropertyOptional({ description: 'Ordering within the set' })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  ordering?: number;
}
