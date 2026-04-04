import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListSubscriptionsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by subscription status' })
  @IsOptional()
  @IsString()
  @IsIn([
    'provisioning',
    'trialing',
    'trial_expired',
    'active',
    'past_due',
    'grace_period',
    'suspended',
    'cancelling',
    'cancelled',
    'expired',
    'complimentary',
    'migrating',
    'terminated',
  ])
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by plan code' })
  @IsOptional()
  @IsString()
  @IsIn(['free', 'edu', 'pro', 'team', 'enterprise'])
  planCode?: string;

  @ApiPropertyOptional({ description: 'Filter by organization ID' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({ description: 'Search by organization name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

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
