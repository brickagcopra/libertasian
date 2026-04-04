import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateNoteDto {
  @ApiPropertyOptional({ description: 'Note title', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiProperty({ description: 'Note body (Tiptap-compatible JSON)' })
  @IsObject()
  @IsNotEmpty()
  body!: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Link to a matter by ID' })
  @IsOptional()
  @IsUUID()
  matterId?: string;

  @ApiPropertyOptional({
    description: 'Visibility',
    enum: ['private', 'org'],
    default: 'private',
  })
  @IsOptional()
  @IsString()
  @IsEnum(['private', 'org'])
  visibility?: string;
}
