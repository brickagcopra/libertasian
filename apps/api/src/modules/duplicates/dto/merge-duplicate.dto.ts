import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MergeDuplicateDto {
  @ApiProperty({ description: 'ID of the document to keep as the primary (canonical) document' })
  @IsUUID()
  keepDocumentId!: string;
}
