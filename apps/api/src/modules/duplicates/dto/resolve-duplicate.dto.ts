import { IsIn, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const RESOLVE_ACTIONS = ['merge', 'dismiss', 'version_update'] as const;

export class ResolveDuplicateDto {
  @ApiProperty({
    description: 'Resolution action',
    enum: RESOLVE_ACTIONS,
  })
  @IsIn(RESOLVE_ACTIONS)
  action!: string;

  @ApiProperty({
    description: 'ID of the document to keep as canonical (required for merge/version_update)',
  })
  @IsUUID()
  keepDocumentId!: string;
}
