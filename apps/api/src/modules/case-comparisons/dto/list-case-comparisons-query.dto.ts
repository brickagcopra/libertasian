import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListCaseComparisonsQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination (last comparison ID)' })
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
    description: 'Filter by comparison type',
    enum: ['full', 'doctrine_only', 'facts_only', 'ruling_only'],
  })
  @IsIn(['full', 'doctrine_only', 'facts_only', 'ruling_only'])
  @IsOptional()
  comparisonType?: string;

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
}
