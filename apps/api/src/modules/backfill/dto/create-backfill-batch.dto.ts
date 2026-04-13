import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsInt,
  Min,
  Max,
  IsNumber,
  IsBoolean,
} from 'class-validator';

export class CreateBackfillBatchDto {
  @IsUUID()
  sourceId!: string;

  @IsOptional()
  @IsUUID()
  sourceEndpointId?: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(1901)
  @Max(2100)
  yearStart!: number;

  @IsInt()
  @Min(1901)
  @Max(2100)
  yearEnd!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  monthStart?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  monthEnd?: number;

  @IsNumber()
  @Min(0.01)
  budgetCeilingUsd!: number;

  @IsOptional()
  @IsString()
  adminNotes?: string;

  @IsOptional()
  @IsBoolean()
  startImmediately?: boolean;
}
