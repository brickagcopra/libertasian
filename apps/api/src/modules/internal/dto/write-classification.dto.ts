import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { BudgetLedgerEntryDto } from './write-derivative.dto';

export class ClassificationAssignmentDto {
  @IsString()
  subjectCode!: string;

  @IsOptional()
  @IsString()
  subjectTopicCode?: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  confidence!: number;

  @IsBoolean()
  isPrimary!: boolean;

  @IsOptional()
  @IsString()
  rationale?: string;
}

export class WriteClassificationDto {
  @IsUUID()
  legalDocumentId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClassificationAssignmentDto)
  assignments!: ClassificationAssignmentDto[];

  @IsOptional()
  @IsUUID()
  classifierModelRunId?: string;

  @IsOptional()
  @IsString()
  classifiedBy?: string; // 'ai' | 'manual'

  /**
   * Classification burned budget that only Redis ever saw. Accepting the
   * entry here writes it in the same call that persists the assignments,
   * so a failed write cannot leave an orphan ledger row.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => BudgetLedgerEntryDto)
  budgetLedgerEntry?: BudgetLedgerEntryDto;
}
