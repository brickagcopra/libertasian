import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListSharesQueryDto {
  @ApiPropertyOptional({ description: 'Entity type to filter shares by', enum: ['matter'] })
  @IsOptional()
  @IsString()
  @IsEnum(['matter'])
  entityType?: string;

  @ApiPropertyOptional({ description: 'Entity ID to filter shares for' })
  @IsOptional()
  @IsUUID()
  entityId?: string;
}
