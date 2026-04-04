import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsIn,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Query DTOs ─────────────────────────────────────────────────────────

export class ListSyllabiQueryDto {
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  activeOnly?: boolean;
}

// ─── Topic CRUD DTOs ────────────────────────────────────────────────────

export class CreateSyllabusTopicDto {
  @IsUUID()
  syllabusId!: string;

  @IsOptional()
  @IsUUID()
  parentTopicId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  slug!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  depth?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  ordering?: number;
}

export class UpdateSyllabusTopicDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  ordering?: number;
}

// ─── Resource DTOs ──────────────────────────────────────────────────────

export class AddSyllabusTopicResourceDto {
  @IsString()
  @IsIn(['legal_document', 'digest', 'flashcard_set', 'reviewer_pack', 'codal_section'])
  resourceType!: string;

  @IsUUID()
  resourceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  ordering?: number;
}

// ─── Progress DTOs ──────────────────────────────────────────────────────

export class SyllabusTopicProgressDto {
  @IsString()
  @IsIn(['not_started', 'in_progress', 'completed'])
  status!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  progressPct?: number;
}
