import {
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
import { Transform, Type } from 'class-transformer';
import { normalizeCourtKey } from '@libertasian/types';

export class ExternalSearchDto {
  @IsString()
  @MaxLength(1000)
  query!: string;

  @IsString()
  @IsOptional()
  documentType?: string;

  // Normalised to the `court_key` the index filters on, so "Supreme Court" and
  // `supreme_court` both work. Deliberately NOT `@IsIn(COURT_VALUES)` like the
  // first-party DTO: rejecting an unrecognised court would turn a partner's
  // existing (if fruitless) request into a 400.
  @Transform(({ value }) =>
    value === undefined || value === null || value === ''
      ? undefined
      : normalizeCourtKey(String(value)),
  )
  @IsString()
  @IsOptional()
  court?: string;

  @IsString()
  @IsOptional()
  ponente?: string;

  @IsUUID()
  @IsOptional()
  sourceId?: string;

  @IsString()
  @IsOptional()
  grNo?: string;

  @IsString()
  @IsOptional()
  dateFrom?: string;

  @IsString()
  @IsOptional()
  dateTo?: string;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  publishedOnly?: boolean;

  @IsInt()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  page?: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @IsIn(['search', 'alac', 'irac', 'concise', 'free_form'])
  @IsOptional()
  mode?: string;
}
