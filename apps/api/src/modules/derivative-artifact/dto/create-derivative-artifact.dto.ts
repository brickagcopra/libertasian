import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { ProvenanceInputDto } from './provenance-input.dto';

/**
 * Canonical derivative types accepted in Phase 1 foundation. The column
 * itself is a free-form VARCHAR(40) so per-type PRs can add new values
 * without a schema migration, but at the API boundary we whitelist the
 * currently known set so nobody accidentally writes `caes_digest` or
 * `mcqs` and scatters typos through the corpus.
 */
export const DERIVATIVE_TYPES = [
  'case_digest',
  'doctrine_extract',
  'mcq_question',
  'essay_prompt',
  'essay_model_answer',
  'suggested_bar_answer',
  'flashcard',
  'subject_outline',
  'sample_pleading',
  'sample_contract',
  'one_page_summary',
] as const;
export type DerivativeType = (typeof DERIVATIVE_TYPES)[number];

export const REVIEW_STATUSES = [
  'draft',
  'needs_human_review',
  'approved',
  'rejected',
] as const;

export const VISIBILITIES = ['private', 'public_editorial', 'unlisted'] as const;
export const AUDIENCES = ['student', 'practitioner', 'both'] as const;
export const CONTENT_RIGHTS = [
  'public_domain_government',
  'ai_generated_derivative',
  'mixed',
] as const;

/**
 * Input DTO for `DerivativeArtifactService.create`. Validated with
 * class-validator + whitelist:true at the global pipe so stray fields are
 * rejected. Shape mirrors `DerivativeArtifact` in schema.prisma minus
 * generated columns (id, timestamps).
 */
export class CreateDerivativeArtifactDto {
  @ApiProperty({ description: 'Canonical derivative type', enum: DERIVATIVE_TYPES })
  @IsIn(DERIVATIVE_TYPES as unknown as string[])
  derivativeType!: DerivativeType;

  @ApiPropertyOptional({ description: 'Source legal_documents row (NULL for standalone derivatives)' })
  @IsUUID()
  @IsOptional()
  sourceDocumentId?: string;

  @ApiPropertyOptional({ description: 'Source legal_document_sections row' })
  @IsUUID()
  @IsOptional()
  sourceSectionId?: string;

  @ApiPropertyOptional({ description: 'Tenant organization (NULL for editorial-corpus derivatives)' })
  @IsUUID()
  @IsOptional()
  organizationId?: string;

  @ApiPropertyOptional({ description: 'User who created this derivative (NULL for system-generated)' })
  @IsUUID()
  @IsOptional()
  createdByUserId?: string;

  @ApiPropertyOptional({ description: 'DerivativeGenerationJob that produced this artifact' })
  @IsUUID()
  @IsOptional()
  derivativeGenerationJobId?: string;

  @ApiProperty({ description: 'Human-readable title' })
  @IsString()
  @MaxLength(1000)
  title!: string;

  @ApiProperty({ description: 'Type-specific structured payload (validated per-type elsewhere)' })
  @IsObject()
  contentJson!: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Plain-text projection for search indexing' })
  @IsString()
  @IsOptional()
  contentPlainText?: string;

  @ApiProperty({ description: 'Stable hash of the canonical content payload (for dedupe)' })
  @IsString()
  @MaxLength(128)
  contentHash!: string;

  @ApiPropertyOptional({ description: 'Total token count (input + output)' })
  @IsInt()
  @Min(0)
  @IsOptional()
  tokenCount?: number;

  @ApiPropertyOptional({ description: 'Validator confidence score (0..1)' })
  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  confidenceScore?: number;

  @ApiPropertyOptional({ description: 'Review lifecycle status', enum: REVIEW_STATUSES })
  @IsIn(REVIEW_STATUSES as unknown as string[])
  @IsOptional()
  reviewStatus?: (typeof REVIEW_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Validator verdict ("pass" | "fail" | "warn" | ...)' })
  @IsString()
  @MaxLength(20)
  @IsOptional()
  validatorVerdict?: string;

  @ApiPropertyOptional({ description: 'Validator rationale / failure reasons' })
  @IsObject()
  @IsOptional()
  validatorReasonsJson?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Visibility class', enum: VISIBILITIES })
  @IsIn(VISIBILITIES as unknown as string[])
  @IsOptional()
  visibility?: (typeof VISIBILITIES)[number];

  @ApiPropertyOptional({ description: 'Target audience', enum: AUDIENCES })
  @IsIn(AUDIENCES as unknown as string[])
  @IsOptional()
  audience?: (typeof AUDIENCES)[number];

  @ApiProperty({ description: 'Content rights class', enum: CONTENT_RIGHTS })
  @IsIn(CONTENT_RIGHTS as unknown as string[])
  contentRights!: (typeof CONTENT_RIGHTS)[number];

  @ApiProperty({
    description:
      'Foreign key to `content_disclaimers.id`. NOT NULL at the DB level — ' +
      'the service will reject writes with an unknown disclaimer id.',
  })
  @IsUUID()
  contentDisclaimerId!: string;

  @ApiPropertyOptional({ description: 'Linked `model_runs` row' })
  @IsUUID()
  @IsOptional()
  modelRunId?: string;

  @ApiPropertyOptional({
    description: 'Subject taxonomy version ("study_8" | "bar_admin_6")',
    enum: ['study_8', 'bar_admin_6'],
  })
  @IsIn(['study_8', 'bar_admin_6'])
  @IsOptional()
  taxonomyVersion?: 'study_8' | 'bar_admin_6';

  @ApiPropertyOptional({ description: 'Content language code', default: 'en' })
  @IsString()
  @MaxLength(10)
  @IsOptional()
  language?: string;

  @ApiProperty({
    description:
      'Provenance rows to write in the same transaction. §4.5 requires ' +
      'at least one row — empty arrays are rejected.',
    type: [ProvenanceInputDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProvenanceInputDto)
  provenanceRecords!: ProvenanceInputDto[];
}
