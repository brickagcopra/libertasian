import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateResearchWorkspaceDto {
  @ApiPropertyOptional({
    description: 'Updated title (3-500 characters)',
    minLength: 3,
    maxLength: 500,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ description: 'Updated description' })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Updated pinned document IDs',
    type: [String],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  pinnedDocumentIds?: string[];

  @ApiPropertyOptional({
    description: 'Updated pinned section IDs',
    type: [String],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  pinnedSectionIds?: string[];

  @ApiPropertyOptional({ description: 'Updated workspace notes' })
  @IsString()
  @MaxLength(10000)
  @IsOptional()
  notes?: string;
}
