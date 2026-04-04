import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListMattersQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination (matter ID)' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Number of results', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Filter by status',
    enum: ['active', 'closed', 'archived'],
  })
  @IsOptional()
  @IsString()
  @IsEnum(['active', 'closed', 'archived'])
  status?: string;

  @ApiPropertyOptional({ description: 'Search by title (partial match)' })
  @IsOptional()
  @IsString()
  search?: string;
}
