import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListPromotionRedemptionsQueryDto {
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
    description: 'Filter by redemption status',
    enum: ['applied', 'revoked'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['applied', 'revoked'])
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by organization ID' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
