import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

// Admin-enqueueable derivative types — strict subset of the student-side
// read DTO in `apps/api/src/modules/derivatives/dto/list-derivatives.query.dto.ts`.
// Every entry here MUST have a matching routing entry in the worker
// `_TASK_ROUTING` dict at
// `services/worker-service/src/tasks/derivative_dispatch_tasks.py`, else
// jobs fail immediately at the dispatcher.
export const ENQUEUEABLE_DERIVATIVE_TYPES = [
  'case_digest',
  'doctrine_extract',
  'mcq_question',
  'essay_prompt',
  'flashcard',
  'subject_outline',
] as const;

export class EnqueueGenerationDto {
  @IsIn(ENQUEUEABLE_DERIVATIVE_TYPES as readonly string[])
  derivativeType!: (typeof ENQUEUEABLE_DERIVATIVE_TYPES)[number];

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @IsOptional()
  @IsString()
  court?: string;

  @IsOptional()
  @IsString()
  subjectCode?: string;

  @IsOptional()
  @IsBoolean()
  regenerateExisting?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  maxCount?: number;
}
