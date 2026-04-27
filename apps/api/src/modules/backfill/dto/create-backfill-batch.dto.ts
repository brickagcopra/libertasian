import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsInt,
  IsIn,
  Min,
  Max,
  IsNumber,
  IsBoolean,
  ValidateIf,
} from 'class-validator';

/**
 * Slug values accepted by {@link CreateBackfillBatchDto.sourceSlug}.
 *
 * The slug resolves to a ``Source`` by matching
 * ``SourceEndpoint.parserType``. Only sources with a matching endpoint are
 * routable through the backfill engine today — other sources should be
 * added to both this map and to ``MONTHLY_URL_BUILDERS`` in the worker
 * service (``services/worker-service/src/tasks/backfill_tasks.py``).
 */
export const BACKFILL_SLUG_TO_PARSER_TYPE: Record<string, string> = {
  lawphil: 'lawphil',
  scel: 'supreme_court_elibrary',
};

export const BACKFILL_SLUGS = Object.keys(BACKFILL_SLUG_TO_PARSER_TYPE);

export class CreateBackfillBatchDto {
  /** Direct source UUID. Mutually exclusive with {@link sourceSlug}. */
  @ValidateIf((o: CreateBackfillBatchDto) => !o.sourceSlug)
  @IsUUID()
  sourceId?: string;

  /**
   * Quality-of-life shortcut: resolve a well-known source by slug instead
   * of looking up its UUID. Mutually exclusive with {@link sourceId}.
   */
  @IsOptional()
  @IsString()
  @IsIn(BACKFILL_SLUGS)
  sourceSlug?: string;

  @IsOptional()
  @IsUUID()
  sourceEndpointId?: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(1901)
  @Max(2100)
  yearStart!: number;

  @IsInt()
  @Min(1901)
  @Max(2100)
  yearEnd!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  monthStart?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  monthEnd?: number;

  @IsNumber()
  @Min(0.01)
  budgetCeilingUsd!: number;

  /**
   * Per-batch concurrency ceiling for in-flight ``process_ingestion_candidate``
   * jobs. Defaults to 25 (set at the DB column level) when omitted. 200 is the
   * hard ceiling so a runaway admin entry can't take down a source.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  inflightCap?: number;

  @IsOptional()
  @IsString()
  adminNotes?: string;

  @IsOptional()
  @IsBoolean()
  startImmediately?: boolean;
}
