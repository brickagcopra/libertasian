import { IsString, IsNotEmpty, IsOptional, IsObject, IsNumber } from 'class-validator';

export class UpdateJobStatusDto {
  @IsString()
  @IsNotEmpty()
  status!: string; // "running" | "completed" | "failed" | "skipped_budget" | "skipped_ineligible"

  @IsOptional()
  @IsString()
  promptTemplateVersion?: string;

  @IsOptional()
  @IsString()
  modelName?: string;

  @IsOptional()
  @IsNumber()
  tokensIn?: number;

  @IsOptional()
  @IsNumber()
  tokensOut?: number;

  @IsOptional()
  @IsNumber()
  estimatedCostUsd?: number;

  @IsOptional()
  @IsObject()
  errorJson?: Record<string, unknown>;
}
