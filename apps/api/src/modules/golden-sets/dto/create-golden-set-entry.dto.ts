import { IsString, IsNotEmpty, IsOptional, IsUUID, IsObject } from 'class-validator';

export class CreateGoldenSetEntryDto {
  @IsString()
  @IsNotEmpty()
  goldenSetType!: string;

  @IsOptional()
  @IsUUID()
  sourceDocumentId?: string;

  @IsObject()
  referenceDataJson!: Record<string, unknown>;
}
