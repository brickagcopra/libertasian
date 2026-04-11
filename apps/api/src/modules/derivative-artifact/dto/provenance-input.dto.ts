import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * One provenance row to be written alongside a `DerivativeArtifact` in the
 * same transaction. §4.5 requires at least one of these per artifact —
 * enforced in `DerivativeArtifactService.create`.
 *
 * Each row points at a `legal_documents` row (always required) and
 * optionally at a specific `legal_document_sections` row when the
 * derivative was produced from a specific passage rather than from the
 * whole document.
 */
export class ProvenanceInputDto {
  @ApiProperty({
    description:
      'UUID of the `legal_documents` row that was used as a source for ' +
      'this derivative (either a source passage or a cited authority).',
  })
  @IsUUID()
  sourceDocumentId!: string;

  @ApiPropertyOptional({
    description:
      'UUID of the specific `legal_document_sections` row used. Omit for ' +
      'document-level provenance (e.g., a cited authority resolved from ' +
      'a citation string).',
  })
  @IsUUID()
  @IsOptional()
  sourceSectionId?: string;

  @ApiProperty({
    description:
      'Why this provenance row exists: `source_passage` for passages the ' +
      'LLM actually read, `cited_authority` for citations resolved from ' +
      'the generated output.',
    enum: ['source_passage', 'cited_authority'],
  })
  @IsIn(['source_passage', 'cited_authority'])
  provenanceType!: 'source_passage' | 'cited_authority';
}
