import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListLifecycleEventsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by event status' })
  @IsOptional()
  @IsString()
  @IsIn(['pending', 'processing', 'completed', 'failed', 'cancelled'])
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by event type' })
  @IsOptional()
  @IsString()
  @IsIn(['cancellation_end', 'renewal', 'trial_expiry', 'grace_period_end'])
  eventType?: string;

  @ApiPropertyOptional({ description: 'Filter by subscription ID' })
  @IsOptional()
  @IsUUID()
  subscriptionId?: string;

  @ApiPropertyOptional({ description: 'Number of items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Cursor for pagination (last item ID)' })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}
