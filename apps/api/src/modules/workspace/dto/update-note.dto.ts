import { IsEnum, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateNoteDto {
  @ApiPropertyOptional({ description: 'Note title', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ description: 'Note body (Tiptap-compatible JSON)' })
  @IsOptional()
  @IsObject()
  body?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Link/unlink to a matter' })
  @IsOptional()
  @IsUUID()
  matterId?: string;

  @ApiPropertyOptional({
    description: 'Visibility',
    enum: ['private', 'org'],
  })
  @IsOptional()
  @IsString()
  @IsEnum(['private', 'org'])
  visibility?: string;
}
