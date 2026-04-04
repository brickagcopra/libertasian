import { IsOptional, IsString, IsUUID, IsIn, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class IngestionJobHistoryQueryDto {
  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @IsOptional()
  @IsIn(['pending', 'running', 'completed', 'failed'])
  status?: string;

  @IsOptional()
  @IsIn(['scheduled', 'manual'])
  triggerType?: string;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
