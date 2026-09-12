import {
  IsString,
  IsNotEmpty,
  IsIn,
  IsOptional,
  IsUUID,
  IsObject,
  IsArray,
  IsNumber,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { BUDGET_SCOPES } from '../../../common/constants/budget-scopes';

export class ProvenanceRecordDto {
  @IsUUID()
  sourceDocumentId!: string;

  @IsOptional()
  @IsUUID()
  sourceSectionId?: string;

  @IsString()
  @IsNotEmpty()
  provenanceType!: string; // "source_passage" | "cited_authority"
}

export class BudgetLedgerEntryDto {
  @IsString()
  @IsNotEmpty()
  periodYearMonth!: string;

  @IsOptional()
  @IsString()
  periodDay?: string;

  /**
   * Budget category. Constrained to BUDGET_SCOPES so a typo fails at the
   * write with a 400 instead of quietly creating a category the admin
   * panel cannot enumerate or budget — which is how `mcq_generation`,
   * `essay_prompt_generation` and friends came to exist.
   */
  @IsIn([...BUDGET_SCOPES])
  scope!: string;

  @IsNumber()
  amountUsd!: number;

  @IsNumber()
  tokensIn!: number;

  @IsNumber()
  tokensOut!: number;

  @IsOptional()
  @IsString()
  modelName?: string;

  @IsOptional()
  @IsString()
  modelRunId?: string;
}

export class WriteDerivativeDto {
  // Artifact fields
  @IsString()
  @IsNotEmpty()
  derivativeType!: string;

  @IsOptional()
  @IsUUID()
  sourceDocumentId?: string;

  @IsOptional()
  @IsUUID()
  sourceSectionId?: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  derivativeGenerationJobId?: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsObject()
  contentJson!: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  contentHash!: string;

  @IsString()
  @IsNotEmpty()
  contentRights!: string;

  @IsUUID()
  contentDisclaimerId!: string;

  @IsOptional()
  @IsString()
  visibility?: string;

  @IsOptional()
  @IsString()
  audience?: string;

  @IsOptional()
  @IsString()
  reviewStatus?: string;

  @IsOptional()
  @IsString()
  validatorVerdict?: string;

  @IsOptional()
  @IsObject()
  validatorReasonsJson?: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  confidenceScore?: number;

  @IsOptional()
  @IsUUID()
  modelRunId?: string;

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
