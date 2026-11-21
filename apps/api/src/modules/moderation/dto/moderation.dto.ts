import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import {
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
