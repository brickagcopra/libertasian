import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

const DOCUMENT_TYPES = [
  'statute',
  'codal',
  'executive_order',
  'republic_act',
  'presidential_decree',
  'constitution',
  'rules_of_court',
  'rule',
  'commonwealth_act',
  'batas_pambansa',
  'proclamation',
  'administrative_order',
] as const;

export const CODAL_TAB_GROUPS = [
  'constitutions',
  'statutes',
  'executive_issuances',
  'rules',
] as const;

export type CodalTabGroup = (typeof CODAL_TAB_GROUPS)[number];

export class ListCodalsBySubjectQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination' })
  @IsUUID()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Filter by document type',
    enum: DOCUMENT_TYPES,
  })
  @IsIn(DOCUMENT_TYPES)
  @IsOptional()
  documentType?: string;

  @ApiPropertyOptional({
    description:
      'Filter by tab group. When set, overrides documentType. ' +
      'Each tab maps to a curated list of document_type values.',
    enum: CODAL_TAB_GROUPS,
  })
  @IsIn(CODAL_TAB_GROUPS)
  @IsOptional()
  tabGroup?: CodalTabGroup;

  @ApiPropertyOptional({ description: 'Search term for title' })
  @IsString()
  @IsOptional()
  search?: string;
}
