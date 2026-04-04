import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListEntitlementOverridesQueryDto {
  @ApiProperty({ description: 'Organization ID to list overrides for' })
  @IsUUID()
  organizationId!: string;

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
