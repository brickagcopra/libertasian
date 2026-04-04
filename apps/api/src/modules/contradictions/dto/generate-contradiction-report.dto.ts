import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateContradictionReportDto {
  @ApiProperty({
    description: 'UUIDs of legal documents to check for contradictions (2-10)',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  documentIds!: string[];

  @ApiPropertyOptional({
    description: 'Scope of contradiction detection',
    enum: ['selected', 'topic_based'],
    default: 'selected',
  })
  @IsIn(['selected', 'topic_based'])
  @IsOptional()
  scope?: string;

  @ApiPropertyOptional({
    description: 'Topic to focus contradiction analysis on (required if scope is topic_based)',
    maxLength: 500,
  })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  topic?: string;
}
