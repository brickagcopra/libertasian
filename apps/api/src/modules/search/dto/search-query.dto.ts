import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  COURT_VALUES,
  DOCUMENT_TYPE_VALUES,
  normalizeCourtKey,
} from '@libertasian/types';

/**
 * Mutable copies of the shared readonly tuples — class-validator's `@IsIn`
 * signature wants `unknown[]`.
 */
const DOCUMENT_TYPES: string[] = [...DOCUMENT_TYPE_VALUES];
const COURTS: string[] = [...COURT_VALUES];

/**
 * Corpora a single `POST /search` call may address. `documents` is the default
 * and reproduces pre-C3 behaviour exactly; see the `scope` field below.
 */
export const SEARCH_SCOPES = ['documents', 'derivatives', 'all'] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];

/** Mutable copy for `@IsIn`, same reason as DOCUMENT_TYPES above. */
const SCOPES: string[] = [...SEARCH_SCOPES];

export class SearchQueryDto {
  @ApiProperty({ description: 'Search query string' })
  @IsString()
  @MaxLength(1000)
  query!: string;

  @ApiPropertyOptional({
    description:
      'Filter by document type. Accepts a single value or an array (multi-select). ' +
      'Values are the shared DOCUMENT_TYPE_VALUES constant, which the web filter ' +
      'UI also consumes so the two can never drift.',
    enum: DOCUMENT_TYPES,
    isArray: true,
  })
  // Accept `?documentType=a&documentType=b`, `documentType=a,b` and a JSON array
  // body. Normalised to string[] so the query builder always sees one shape.
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const raw = Array.isArray(value) ? value : String(value).split(',');
    const values = raw
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0);
    return values.length > 0 ? values : undefined;
  })
  @IsArray()
  @IsIn(DOCUMENT_TYPES, { each: true })
  @IsOptional()
  documentType?: string[];

  @ApiPropertyOptional({
    description:
      'Filter by court. Accepts the snake_case key (`supreme_court`) or the ' +
      'display form as stored in PostgreSQL ("Supreme Court") — both normalise ' +
      'to the `court_key` the index is filtered on.',
    enum: COURTS,
  })
  // Normalising here is what lets the same value work from the web dropdown,
  // a saved search, and a client that echoes back a document's display court.
  @Transform(({ value }) =>
    value === undefined || value === null || value === ''
      ? undefined
      : normalizeCourtKey(String(value)),
  )
  @IsIn(COURTS)
  @IsOptional()
  court?: string;

  @ApiPropertyOptional({ description: 'Filter by ponente' })
  @IsString()
  @IsOptional()
  ponente?: string;

  @ApiPropertyOptional({ description: 'Filter by source ID' })
  @IsUUID()
  @IsOptional()
  sourceId?: string;

  @ApiPropertyOptional({ description: 'Filter by G.R. Number' })
  @IsString()
  @IsOptional()
  grNo?: string;

  @ApiPropertyOptional({ description: 'Filter by decision date from (YYYY-MM-DD)' })
  @IsString()
  @IsOptional()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Filter by decision date to (YYYY-MM-DD)' })
  @IsString()
  @IsOptional()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Only show published documents' })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  publishedOnly?: boolean;

  @ApiPropertyOptional({ description: 'Page number (0-based)', default: 0 })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ description: 'Results per page', default: 20 })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Answer mode for AI-powered results',
    enum: ['search', 'alac', 'irac', 'concise', 'free_form'],
    default: 'search',
  })
  @IsIn(['search', 'alac', 'irac', 'concise', 'free_form'])
  @IsOptional()
  mode?: string;

  @ApiPropertyOptional({
    description:
      'Which corpora to search. `documents` (the default) is the legal-document ' +
      'corpus and is exactly the pre-C3 behaviour. `derivatives` searches ' +
      'derivative artifacts (digests, outlines, flashcards, model answers). ' +
      '`all` searches both, and results then carry a `kind` discriminator. ' +
      'OMITTING this field returns the legacy response shape byte-for-byte — ' +
      'no `kind`, no added meta — so pre-C3 clients are unaffected.',
    enum: SCOPES,
    default: 'documents',
  })
  @IsIn(SCOPES)
  @IsOptional()
  scope?: SearchScope;
}
