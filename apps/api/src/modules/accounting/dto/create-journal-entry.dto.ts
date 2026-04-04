import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class JournalEntryLineDto {
  @IsUUID()
  @IsNotEmpty()
  accountId: string;

  @IsInt()
  @Min(0)
  debitAmount: number;

  @IsInt()
  @Min(0)
  creditAmount: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  subscriptionId?: string;
}

export class CreateJournalEntryDto {
  @IsDateString()
  @IsNotEmpty()
  entryDate: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsOptional()
  @IsEnum([
    'MANUAL',
    'PAYMENT',
    'REFUND',
    'REVENUE_RECOGNITION',
    'EXPENSE',
    'SUBSCRIPTION_CHANGE',
    'SYSTEM',
  ])
  sourceType?: string;

  @IsOptional()
  @IsUUID()
  sourceRefId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isAuto?: boolean;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalEntryLineDto)
  lines: JournalEntryLineDto[];
}
