import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListPleadingsQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination (last pleading ID)' })
  @IsUUID()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Number of items per page', default: 20 })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Filter by status',
    enum: ['pending', 'generating', 'completed', 'failed'],
  })
  @IsIn(['pending', 'generating', 'completed', 'failed'])
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by linked matter' })
  @IsUUID()
  @IsOptional()
  matterId?: string;

  @ApiPropertyOptional({
    description: 'Filter by template category',
    enum: ['motion', 'complaint', 'petition', 'answer', 'memorandum', 'appeal', 'other'],
  })
  @IsIn(['motion', 'complaint', 'petition', 'answer', 'memorandum', 'appeal', 'other'])
  @IsOptional()
  category?: string;
}
