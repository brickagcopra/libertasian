import { IsIn, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class BulkRetryLifecycleEventsDto {
  @ApiPropertyOptional({ description: 'Filter by event type for bulk retry' })
  @IsOptional()
  @IsString()
  @IsIn(['cancellation_end', 'renewal', 'trial_expiry', 'grace_period_end'])
  eventType?: string;
}
