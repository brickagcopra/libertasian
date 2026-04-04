import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateDigestDto {
  @ApiProperty({ description: 'Legal document ID to generate digest from' })
  @IsUUID()
  legalDocumentId!: string;

  @ApiPropertyOptional({
    description: 'Type of digest to generate',
    enum: ['case_digest', 'statute_summary', 'reviewer_note', 'study_digest'],
    default: 'case_digest',
  })
  @IsIn(['case_digest', 'statute_summary', 'reviewer_note', 'study_digest'])
  @IsOptional()
  digestType?: string;
}
