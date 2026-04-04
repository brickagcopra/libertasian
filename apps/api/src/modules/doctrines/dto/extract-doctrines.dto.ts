import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExtractDoctrinesDto {
  @ApiProperty({ description: 'Legal document to extract doctrines from' })
  @IsUUID()
  legalDocumentId!: string;

  @ApiPropertyOptional({
    description: 'Extraction strategy',
    enum: ['auto', 'full_text', 'sections_only'],
    default: 'auto',
  })
  @IsIn(['auto', 'full_text', 'sections_only'])
  @IsOptional()
  strategy?: string;
}
