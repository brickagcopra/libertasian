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
}
