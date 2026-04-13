import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsObject,
  IsArray,
  IsNumber,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { ProvenanceRecordDto, BudgetLedgerEntryDto } from './write-derivative.dto';

export class WriteDigestDto {
  @IsUUID()
  legalDocumentId!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  sourceOrigin!: string; // 'ai_generated'

  @IsOptional()
  @IsString()
  facts?: string;

  @IsOptional()
  @IsString()
  issues?: string;

  @IsOptional()
  @IsString()
  ruling?: string;

  @IsOptional()
  @IsString()
  doctrine?: string;

  @IsOptional()
  @IsString()
  dispositive?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  petitionerArguments?: string;

  @IsOptional()
  @IsString()
  respondentArguments?: string;

  @IsOptional()
  @IsArray()
  citedAuthoritiesJson?: Record<string, unknown>[];

  @IsOptional()
  @IsNumber()
  confidenceScore?: number;

  @IsOptional()
  @IsString()
  reviewStatus?: string;

  @IsOptional()
  @IsString()
  visibility?: string;

  @IsOptional()
  @IsString()
  validatorVerdict?: string;

  @IsOptional()
  @IsObject()
  validatorReasonsJson?: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  modelRunId?: string;

  @IsOptional()
  @IsString()
  promptTemplateVersion?: string;

  @IsOptional()
  @IsUUID()
  contentDisclaimerId?: string;

  @IsOptional()
  @IsUUID()
  derivativeGenerationJobId?: string;

  @IsOptional()
  @IsArray()
  sectionUsageJson?: Record<string, unknown>[];

  // Provenance records (at least one required — enforced at service level)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProvenanceRecordDto)
  provenanceRecords!: ProvenanceRecordDto[];

  // Optional budget ledger entry (written in same transaction)
  @IsOptional()
  @ValidateNested()
  @Type(() => BudgetLedgerEntryDto)
  budgetLedgerEntry?: BudgetLedgerEntryDto;
}
