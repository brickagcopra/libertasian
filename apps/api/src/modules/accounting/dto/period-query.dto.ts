import { IsOptional, IsUUID } from 'class-validator';

export class PeriodQueryDto {
  @IsOptional()
  @IsUUID()
  period?: string;
}
