import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AddMatterDocumentDto {
  @ApiPropertyOptional({ description: 'Legal document ID from corpus' })
  @IsOptional()
  @IsUUID()
  legalDocumentId?: string;

  @ApiPropertyOptional({ description: 'User upload ID' })
  @IsOptional()
  @IsUUID()
  userUploadId?: string;

  @ApiPropertyOptional({ description: 'Display title override', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({
    description: 'Document role in this matter',
    enum: ['evidence', 'reference', 'pleading', 'research', 'note'],
    default: 'reference',
  })
  @IsOptional()
  @IsString()
  @IsEnum(['evidence', 'reference', 'pleading', 'research', 'note'])
  role?: string;
}
