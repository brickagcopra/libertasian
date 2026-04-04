import { IsArray, IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListAllAuditLogsQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination (audit log ID)' })
  @IsOptional()
  @IsUUID('4')
  cursor?: string;

  @ApiPropertyOptional({ description: 'Number of items per page', default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Filter by action(s)',
    example: ['role.assigned', 'document.created'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.includes(',') ? value.split(',') : [value];
    return value;
  })
  action?: string[];

  @ApiPropertyOptional({
    description: 'Filter by entity type(s)',
    example: ['member_role', 'role_definition', 'document', 'digest'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.includes(',') ? value.split(',') : [value];
    return value;
  })
  entityType?: string[];

  @ApiPropertyOptional({ description: 'Filter by actor user ID' })
  @IsOptional()
  @IsUUID('4')
  actorUserId?: string;

  @ApiPropertyOptional({ description: 'Filter from date (ISO 8601)', example: '2025-01-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Filter to date (ISO 8601)', example: '2025-12-31T23:59:59Z' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
