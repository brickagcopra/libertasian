import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

import { BudgetLedgerEntryDto } from './write-derivative.dto';

export class McqOptionEntryDto {
  @IsString()
  @IsNotEmpty()
  label!: string; // "A" | "B" | "C" | "D"

  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsBoolean()
  isCorrect!: boolean;

  @IsOptional()
  @IsString()
  rationale?: string;
}

export class McqQuestionEntryDto {
  @IsString()
  @IsNotEmpty()
  questionStem!: string;

  @IsOptional()
  @IsString()
  explanation?: string;

  @IsString()
  @IsNotEmpty()
  difficulty!: string; // "easy" | "medium" | "hard" | "bar_exam_level"

  @IsString()
  @IsNotEmpty()
  questionFormat!: string; // "single_best"

  @IsOptional()
  @IsUUID()
  subjectTopicId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => McqOptionEntryDto)
  options!: McqOptionEntryDto[];

  @IsArray()
  @IsUUID('all', { each: true })
  supportingSectionIds!: string[];
}

export class WriteMcqBatchDto {
  @IsUUID()
  sourceDocumentId!: string;

  @IsObject()
  contentJson!: Record<string, unknown>; // full McqGenerationOutput

  @IsString()
  @IsNotEmpty()
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
  @Type(() => McqQuestionEntryDto)
  questions!: McqQuestionEntryDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => BudgetLedgerEntryDto)
  budgetLedgerEntry?: BudgetLedgerEntryDto;
}
