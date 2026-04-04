import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateCaseComparisonDto {
  @ApiProperty({
    description: 'Array of legal document UUIDs to compare (2-5)',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(5)
  @IsUUID('4', { each: true })
  documentIds!: string[];

  @ApiProperty({
    description: 'Type of comparison to perform',
    enum: ['full', 'doctrine_only', 'facts_only', 'ruling_only'],
  })
  @IsIn(['full', 'doctrine_only', 'facts_only', 'ruling_only'])
  comparisonType!: string;

  @ApiPropertyOptional({ description: 'Link comparison to a specific matter' })
  @IsUUID()
  @IsOptional()
  matterId?: string;
}
