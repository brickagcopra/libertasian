import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

import { ProvenanceRecordDto, BudgetLedgerEntryDto } from './write-derivative.dto';

export class RelatedDoctrineDto {
  @IsOptional()
  @IsUUID()
  existingDoctrineId?: string | null;

  @IsString()
  linkType!: string; // "supports" | "refines" | "contradicts"
}

export class DoctrineEntryDto {
  @IsString()
  text!: string;

  @IsOptional()
  @IsString()
  normalizedText?: string;

  @IsString()
  verbatimSourceText!: string;

  @IsString()
  doctrineType!: string; // rule | test | definition | exception | procedural

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsNumber()
  confidence?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RelatedDoctrineDto)
  relatedDoctrines?: RelatedDoctrineDto[];
}

export class WriteDoctrinesDto {
  @IsUUID()
  sourceDocumentId!: string;

  @IsObject()
  contentJson!: Record<string, unknown>; // full DoctrineExtractOutput

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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DoctrineEntryDto)
  doctrines!: DoctrineEntryDto[];

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
