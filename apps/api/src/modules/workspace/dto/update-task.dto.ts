import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateTaskDto {
  @ApiPropertyOptional({ description: 'Task title', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ description: 'Task description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Matter to link this task to (null to unlink)' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  matterId?: string | null;

  @ApiPropertyOptional({ description: 'User ID to assign the task to (null to unassign)' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  assignedToUserId?: string | null;

  @ApiPropertyOptional({
    description: 'Task status',
    enum: ['todo', 'in_progress', 'done', 'cancelled'],
  })
  @IsOptional()
  @IsString()
  @IsEnum(['todo', 'in_progress', 'done', 'cancelled'])
  status?: string;

  @ApiPropertyOptional({
    description: 'Task priority',
    enum: ['low', 'medium', 'high', 'urgent'],
  })
  @IsOptional()
  @IsString()
  @IsEnum(['low', 'medium', 'high', 'urgent'])
  priority?: string;

  @ApiPropertyOptional({ description: 'Due date (ISO 8601, null to clear)' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  dueDate?: string | null;
}
