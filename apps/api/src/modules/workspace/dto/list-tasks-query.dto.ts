import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListTasksQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination (task ID)' })
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
    enum: ['todo', 'in_progress', 'done', 'cancelled'],
  })
  @IsOptional()
  @IsString()
  @IsEnum(['todo', 'in_progress', 'done', 'cancelled'])
  status?: string;

  @ApiPropertyOptional({
    description: 'Filter by priority',
    enum: ['low', 'medium', 'high', 'urgent'],
  })
  @IsOptional()
  @IsString()
  @IsEnum(['low', 'medium', 'high', 'urgent'])
  priority?: string;

  @ApiPropertyOptional({ description: 'Filter by assignee user ID' })
  @IsOptional()
  @IsUUID()
  assignedToUserId?: string;

  @ApiPropertyOptional({ description: 'Filter by linked matter ID' })
  @IsOptional()
  @IsUUID()
  matterId?: string;

  @ApiPropertyOptional({ description: 'Search by title (partial match)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter tasks due before this date (ISO 8601)' })
  @IsOptional()
  @IsString()
  dueBefore?: string;

  @ApiPropertyOptional({ description: 'Filter tasks due after this date (ISO 8601)' })
  @IsOptional()
  @IsString()
  dueAfter?: string;
}
