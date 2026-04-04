import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListSubscriptionHistoryQueryDto {
  @ApiPropertyOptional({ description: 'Filter by action type' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ description: 'Filter by actor type' })
  @IsOptional()
  @IsString()
  @IsIn(['user', 'admin', 'system'])
  actorType?: string;

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
