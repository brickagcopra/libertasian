import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { BudgetLedgerEntryDto } from './write-derivative.dto';

export class FlashcardEntryDto {
  @IsString()
  @IsNotEmpty()
  front!: string;

  @IsString()
  @IsNotEmpty()
  back!: string;

  @IsOptional()
  @IsString()
  mnemonicHint?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsUUID()
  legalDocumentId?: string;
}

export class WriteFlashcardsDto {
  // FlashcardSet fields
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  barSubject?: string;

  @IsOptional()
  @IsString()
  topic?: string;

  @IsString()
  @IsNotEmpty()
  visibility!: string; // 'private' | 'public_editorial'

  // Required: FlashcardSet.organization_id + user_id are NOT NULL in the
  // schema. The worker used to pass undefined on admin bulk-gen, which
  // slipped past @IsOptional and hit Prisma with an empty-string default;
  // the admin path now skips this endpoint entirely and writes a
  // derivative_artifact row instead, so enforcing these here is safe.
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  userId!: string;

  // Source info
  @IsOptional()
  @IsUUID()
  sourceDocumentId?: string;

  @IsOptional()
  @IsUUID()
  digestId?: string;

  // Cards
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlashcardEntryDto)
  cards!: FlashcardEntryDto[];

  // Generation metadata
  @IsOptional()
  @IsUUID()
  derivativeGenerationJobId?: string;

  @IsOptional()
  @IsUUID()
  modelRunId?: string;

  // Budget
  @IsOptional()
  @ValidateNested()
  @Type(() => BudgetLedgerEntryDto)
  budgetLedgerEntry?: BudgetLedgerEntryDto;
}
