import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListAdminUsersQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination (last item ID)' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Number of items per page (max 100)', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Search by email or fullName (case-insensitive ILIKE)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by user status' })
  @IsOptional()
  @IsString()
  @IsIn(['active', 'suspended', 'deactivated'])
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by onboarding userRole' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  role?: string;

  @ApiPropertyOptional({ description: 'Filter by current plan tier on any membership org' })
  @IsOptional()
  @IsString()
  @IsIn(['free', 'edu', 'pro', 'team', 'enterprise'])
  planTier?: string;

  @ApiPropertyOptional({ description: 'Filter to users with at least one active subscription' })
  @IsOptional()
  @IsBooleanString()
  hasActiveSubscription?: string;

  @ApiPropertyOptional({ description: 'Sort field', default: 'createdAt' })
  @IsOptional()
  @IsString()
  @IsIn(['createdAt', 'email'])
  sortBy?: 'createdAt' | 'email';

  @ApiPropertyOptional({ description: 'Sort direction', default: 'desc' })
  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';
}
