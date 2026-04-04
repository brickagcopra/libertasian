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

export class AddReviewerPackItemDto {
  @ApiProperty({
    description: 'Type of item',
    enum: ['legal_document', 'digest', 'section'],
  })
  @IsIn(['legal_document', 'digest', 'section'])
  itemType!: string;

  @ApiPropertyOptional({ description: 'Legal document ID' })
  @IsUUID()
  @IsOptional()
  legalDocumentId?: string;

  @ApiPropertyOptional({ description: 'Digest ID' })
  @IsUUID()
  @IsOptional()
  digestId?: string;

  @ApiPropertyOptional({ description: 'Section ID' })
  @IsUUID()
  @IsOptional()
  sectionId?: string;

  @ApiPropertyOptional({ description: 'Ordering within the pack', default: 0 })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  ordering?: number;

  @ApiPropertyOptional({ description: 'Note about this item' })
  @IsString()
  @IsOptional()
  note?: string;
}

export class UpdateReviewerPackItemDto {
  @ApiPropertyOptional({ description: 'Ordering within the pack' })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  ordering?: number;

  @ApiPropertyOptional({ description: 'Note about this item' })
  @IsString()
  @IsOptional()
  note?: string;
}
