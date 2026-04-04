import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListRedemptionsQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination (redemption ID)' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Page size (default: 20, max: 100)', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Filter by status',
    enum: ['reserved', 'redeemed', 'rolled_back', 'expired'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['reserved', 'redeemed', 'rolled_back', 'expired'])
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by organization ID' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
