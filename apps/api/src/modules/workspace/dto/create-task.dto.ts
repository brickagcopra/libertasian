import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTaskDto {
  @ApiProperty({ description: 'Task title', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title!: string;

  @ApiPropertyOptional({ description: 'Task description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Matter to link this task to' })
  @IsOptional()
  @IsUUID()
  matterId?: string;

  @ApiPropertyOptional({ description: 'User ID to assign the task to' })
  @IsOptional()
  @IsUUID()
  assignedToUserId?: string;

  @ApiPropertyOptional({
    description: 'Task priority',
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium',
  })
  @IsOptional()
  @IsString()
  @IsEnum(['low', 'medium', 'high', 'urgent'])
  priority?: string;

  @ApiPropertyOptional({ description: 'Due date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
