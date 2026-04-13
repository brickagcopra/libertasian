import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateAiSettingDto {
  @IsObject()
  @IsNotEmpty()
  value!: Record<string, unknown>;
}

/**
 * Update the global LLM budget ceilings. Monthly is required; daily is
 * optional — pass `null` to remove an existing daily cap, omit to leave
 * it unchanged.
 *
 * Backs the `/admin/budget` page specified in §7.2 of the corpus-platform
 * target architecture.
 */
export class UpdateBudgetDto {
  @IsNumber()
  @Min(0)
  @Max(100000)
  monthlyBudgetUsd!: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(0)
  @Max(100000)
  dailyBudgetUsd?: number | null;
}

/**
 * Allowlist of IANA timezones the admin may select for the global
 * ingestion window. Validated via `IsIn` rather than hard-coded so the
 * list can be extended without loosening validation.
 */
export const INGESTION_WINDOW_TIMEZONES = ['Asia/Manila'] as const;
export type IngestionWindowTimezone = (typeof INGESTION_WINDOW_TIMEZONES)[number];

const HH_MM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Update the global ingestion wall-clock window specified in §7.3.
 * Wall-clock start/stop times in `HH:MM` 24-hour format plus an IANA
 * timezone. All three fields move together.
 */
export class UpdateIngestionWindowDto {
  @IsString()
  @Matches(HH_MM_REGEX, {
    message: 'startLocal must be a 24-hour HH:MM time (e.g. "02:00")',
  })
  startLocal!: string;

  @IsString()
  @Matches(HH_MM_REGEX, {
    message: 'stopLocal must be a 24-hour HH:MM time (e.g. "06:00")',
  })
  stopLocal!: string;

  @IsString()
  @IsIn(INGESTION_WINDOW_TIMEZONES, {
    message: `timezone must be one of: ${INGESTION_WINDOW_TIMEZONES.join(', ')}`,
  })
  timezone!: IngestionWindowTimezone;
}

export class IngestionScheduleEntry {
  @IsString()
  @IsNotEmpty()
  sourceKey!: string;

  @IsString()
  @Matches(/^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/, {
    message: 'Invalid cron expression. Expected format: "* * * * *"',
  })
  cron!: string;

  enabled!: boolean;
}

export class UpdateIngestionScheduleDto {
  enabled!: boolean;

  schedules!: IngestionScheduleEntry[];
}

export class ResetUsageDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}$/, { message: 'Month must be in YYYY-MM format' })
  month!: string;

  @IsString()
  @IsNotEmpty()
  confirmation!: string;
}
