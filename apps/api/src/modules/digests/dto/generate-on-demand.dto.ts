import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateOnDemandDto {
  @ApiProperty({
    description:
      'Legal document to generate a case digest for. Must exist in legal_documents.',
  })
  @IsUUID()
  legalDocumentId!: string;
}
