import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { ProvenanceRecordDto, BudgetLedgerEntryDto } from './write-derivative.dto';

export class WriteEssayDto {
  @IsUUID()
  sourceDocumentId!: string;

  // EssayPrompt fields
  @IsString()
  promptText!: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(90)
  suggestedTimeMinutes?: number;

  @IsOptional()
  @IsObject()
  modelAnswerJson?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  rubricJson?: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  subjectTopicId?: string;

  @IsOptional()
  @IsUUID()
  barExamSittingId?: string;

  // DerivativeArtifact fields
  @IsObject()
  contentJson!: Record<string, unknown>;

  @IsString()
  contentRights!: string;

  @IsUUID()
  contentDisclaimerId!: string;

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

  @IsOptional()
  @IsUUID()
  derivativeGenerationJobId?: string;

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
