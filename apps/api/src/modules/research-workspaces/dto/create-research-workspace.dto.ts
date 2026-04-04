import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateResearchWorkspaceDto {
  @ApiProperty({
    description: 'Title for the research workspace (3-500 characters)',
    minLength: 3,
    maxLength: 500,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  title!: string;

  @ApiPropertyOptional({ description: 'Description of the research workspace' })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'UUIDs of documents to pin to the workspace context',
    type: [String],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  pinnedDocumentIds?: string[];
}
