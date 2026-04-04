import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAnnotationDto {
  @ApiProperty({ description: 'Legal document to annotate' })
  @IsUUID()
  @IsNotEmpty()
  legalDocumentId!: string;

  @ApiPropertyOptional({ description: 'Document section to annotate' })
  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @ApiProperty({
    description: 'Text anchor (start_offset, end_offset, anchor_text)',
    example: { startOffset: 0, endOffset: 50, anchorText: 'The court held...' },
  })
  @IsObject()
  @IsNotEmpty()
  textAnchor!: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Annotation comment text' })
  @IsOptional()
  @IsString()
  annotationText?: string;

  @ApiPropertyOptional({
    description: 'Highlight color',
    enum: ['yellow', 'green', 'blue', 'red', 'purple'],
    default: 'yellow',
  })
  @IsOptional()
  @IsString()
  @IsEnum(['yellow', 'green', 'blue', 'red', 'purple'])
  color?: string;
}
