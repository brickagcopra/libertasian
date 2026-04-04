import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBookmarkDto {
  @ApiProperty({ description: 'Legal document to bookmark' })
  @IsUUID()
  legalDocumentId!: string;

  @ApiPropertyOptional({ description: 'Optional section within the document' })
  @IsUUID()
  @IsOptional()
  legalDocumentSectionId?: string;

  @ApiPropertyOptional({ description: 'Optional note about the bookmark' })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  note?: string;
}
