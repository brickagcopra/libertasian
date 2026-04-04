import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExtractDoctrinesBatchDto {
  @ApiProperty({
    description: 'Legal document IDs to extract doctrines from (1-50)',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  legalDocumentIds!: string[];

  @ApiPropertyOptional({
    description: 'Extraction strategy',
    enum: ['auto', 'full_text', 'sections_only'],
    default: 'auto',
  })
  @IsIn(['auto', 'full_text', 'sections_only'])
  @IsOptional()
  strategy?: string;
}
