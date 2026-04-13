import { IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateBudgetSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyCeilingUsd?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  dailyCeilingUsd?: number;
}
