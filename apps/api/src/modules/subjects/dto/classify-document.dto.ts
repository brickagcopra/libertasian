import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class ClassifyDocumentDto {
  @IsOptional()
  @IsUUID()
  legalDocumentId?: string;

  @IsOptional()
  @IsUUID()
  derivativeArtifactId?: string;

  @IsUUID()
  subjectId!: string;

  @IsOptional()
  @IsUUID()
  subjectTopicId?: string;

  @IsBoolean()
  isPrimary!: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @IsOptional()
  @IsString()
  classifiedBy?: string;

  @IsOptional()
  @IsUUID()
  classifierModelRunId?: string;
}
