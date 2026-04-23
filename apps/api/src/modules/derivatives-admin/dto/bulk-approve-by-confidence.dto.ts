import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

import { ENQUEUEABLE_DERIVATIVE_TYPES } from './enqueue-generation.dto';

/**
 * Batch-approve all private artifacts (and optionally digests) whose
 * `confidence_score >= threshold`. Used by the admin UI to promote
 * a bulk-generation run without manual per-row clicks.
 *
 * When `dryRun` is true the endpoint returns candidate counts without
 * writing. Pair the UI "Preview counts" button with this flag.
 */
export class BulkApproveByConfidenceDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  threshold!: number;

  /**
   * Optional allow-list of derivative types. Omit to approve candidates
   * across every enqueueable type. Values must be in
   * {@link ENQUEUEABLE_DERIVATIVE_TYPES}; anything else → 400.
   */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(ENQUEUEABLE_DERIVATIVE_TYPES as readonly string[], { each: true })
  derivativeTypes?: (typeof ENQUEUEABLE_DERIVATIVE_TYPES)[number][];

  /** Include digests in the sweep. Defaults to true. */
  @IsOptional()
  @IsBoolean()
  includeDigests?: boolean;

  /** When true, return counts only; do not write. Defaults to false. */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export interface BulkApproveByConfidenceResult {
  dryRun: boolean;
  artifactsPromoted: number;
  digestsPromoted: number;
  subjectsInherited: number;
  perTypeBreakdown: Array<{ derivativeType: string; count: number }>;
  errors: Array<{ entityType: string; entityId: string; reason: string }>;
}
