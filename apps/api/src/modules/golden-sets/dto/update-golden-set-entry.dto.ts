import { IsString, IsOptional, IsObject } from 'class-validator';

export class UpdateGoldenSetEntryDto {
  @IsOptional()
  @IsObject()
  referenceDataJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  reviewNotes?: string;
}
