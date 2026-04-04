import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListActivityQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination (audit log ID)' })
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
    description: 'Filter by entity type',
    enum: ['matter', 'note', 'task', 'annotation', 'matter_document', 'task_comment'],
  })
  @IsOptional()
  @IsString()
  @IsEnum(['matter', 'note', 'task', 'annotation', 'matter_document', 'task_comment'])
  entityType?: string;

  @ApiPropertyOptional({ description: 'Filter by actor user ID' })
  @IsOptional()
  @IsUUID()
  actorUserId?: string;
}
