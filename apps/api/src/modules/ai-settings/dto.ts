import { IsNotEmpty, IsNumber, IsObject, IsString, Max, Min, Matches } from 'class-validator';

export class UpdateAiSettingDto {
  @IsObject()
  @IsNotEmpty()
  value!: Record<string, unknown>;
}

export class UpdateBudgetDto {
  @IsNumber()
  @Min(0)
  @Max(10000)
  amount!: number;
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
