import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import {
  APPEAL_STATUSES,
  BULK_MAX_CASES,
  MODERATION_REASONS,
  MODERATION_TARGET_TYPES,
  MODERATION_TYPE_FILTERS,
  SANCTION_TYPES,
  SUSPENSION_DAYS,
} from '../moderation.constants';

export class ListCasesQueryDto {
  @IsOptional()
  @IsIn(['open', 'resolved'])
  status?: 'open' | 'resolved';

  @IsOptional()
  @IsIn(MODERATION_TYPE_FILTERS)
  type?: (typeof MODERATION_TYPE_FILTERS)[number];

  @IsOptional()
  @IsIn(['oldest', 'newest', 'most_reported'])
  sort?: 'oldest' | 'newest' | 'most_reported';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  offset?: number;
}

export class CaseParamsDto {
  @IsIn(MODERATION_TARGET_TYPES)
  targetType!: (typeof MODERATION_TARGET_TYPES)[number];

  @IsUUID()
  targetId!: string;
}

export class ResolveCaseDto {
  @IsIn(['dismiss', 'remove'])
  decision!: 'dismiss' | 'remove';

  @ValidateIf((o: ResolveCaseDto) => o.decision === 'remove' || o.reason !== undefined)
  @IsIn(MODERATION_REASONS)
  reason?: (typeof MODERATION_REASONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsBoolean()
  notifyAuthor?: boolean;
}

export class NoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CreateSanctionDto {
  @IsIn(SANCTION_TYPES)
  type!: (typeof SANCTION_TYPES)[number];

  @IsIn(MODERATION_REASONS)
  reason!: (typeof MODERATION_REASONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ValidateIf((o: CreateSanctionDto) => o.type === 'suspension' || o.durationDays !== undefined)
  @IsIn(SUSPENSION_DAYS)
  durationDays?: (typeof SUSPENSION_DAYS)[number];

  @IsOptional()
  @IsBoolean()
  removeContent?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyUser?: boolean;
}

export class ListSanctionsQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export class CursorQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export class CaseRefDto {
  @IsIn(MODERATION_TARGET_TYPES)
  targetType!: (typeof MODERATION_TARGET_TYPES)[number];

  @IsUUID()
  targetId!: string;
}

export class BulkResolveDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_MAX_CASES)
  @ValidateNested({ each: true })
  @Type(() => CaseRefDto)
  cases!: CaseRefDto[];

  @IsIn(['dismiss', 'remove'])
  decision!: 'dismiss' | 'remove';

  @ValidateIf((o: BulkResolveDto) => o.decision === 'remove' || o.reason !== undefined)
  @IsIn(MODERATION_REASONS)
  reason?: (typeof MODERATION_REASONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsBoolean()
  notifyAuthor?: boolean;
}

export class ListAppealsQueryDto {
  @IsOptional()
  @IsIn(APPEAL_STATUSES)
  status?: (typeof APPEAL_STATUSES)[number];

  /** Internal: narrow to one appeal (not exposed by the controller). */
  id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export class DecideAppealDto {
  @IsIn(['grant', 'deny'])
  decision!: 'grant' | 'deny';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class FileAppealDto {
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  statement!: string;
}
