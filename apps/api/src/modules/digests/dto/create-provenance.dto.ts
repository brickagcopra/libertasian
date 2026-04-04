import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProvenanceDto {
  @ApiProperty({
    description: 'Type of entity this provenance links to',
    enum: ['document', 'section', 'digest', 'answer'],
  })
  @IsIn(['document', 'section', 'digest', 'answer'])
  entityType!: string;

  @ApiProperty({ description: 'ID of the entity' })
  @IsUUID()
  entityId!: string;

  @ApiProperty({ description: 'Source document that the entity derives from' })
  @IsUUID()
  sourceDocumentId!: string;

  @ApiPropertyOptional({ description: 'Source section within the document' })
  @IsUUID()
  @IsOptional()
  sourceSectionId?: string;

  @ApiProperty({
    description: 'How the entity relates to the source',
    enum: ['quoted', 'derived', 'summarized', 'ocr_extracted'],
  })
  @IsIn(['quoted', 'derived', 'summarized', 'ocr_extracted'])
  provenanceType!: string;
}
