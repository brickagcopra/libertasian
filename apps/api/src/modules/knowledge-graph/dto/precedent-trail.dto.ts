import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class PrecedentTrailQueryDto {
  @ApiPropertyOptional({ description: 'Starting legal document ID' })
  @IsUUID()
  @IsOptional()
  documentId?: string;

  @ApiPropertyOptional({ description: 'Starting doctrine extract ID' })
  @IsUUID()
  @IsOptional()
  doctrineId?: string;

  @ApiPropertyOptional({
    description: 'Free-text doctrine to search for (used if no IDs provided)',
    maxLength: 500,
  })
  @IsString()
  @IsOptional()
  doctrineText?: string;

  @ApiPropertyOptional({
    description: 'Max BFS depth for citation traversal',
    default: 3,
    minimum: 1,
    maximum: 5,
  })
  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  @Type(() => Number)
  depth?: number;
}
