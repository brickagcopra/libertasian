import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GraphQueryDto {
  @ApiProperty({ description: 'Starting document ID' })
  @IsUUID()
  documentId!: string;

  @ApiPropertyOptional({
    description: 'BFS depth limit (max 3)',
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  depth?: number;
}

export class NetworkQueryDto {
  @ApiProperty({ description: 'Center document ID for network graph' })
  @IsUUID()
  documentId!: string;

  @ApiPropertyOptional({
    description: 'BFS depth limit (max 3)',
    default: 2,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  depth?: number;
}

export class UnresolvedCitationsQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Filter by citation type',
  })
  @IsOptional()
  @IsString()
  citationType?: string;

  @ApiPropertyOptional({
    description: 'Filter by source document ID',
  })
  @IsOptional()
  @IsUUID()
  fromDocumentId?: string;
}
