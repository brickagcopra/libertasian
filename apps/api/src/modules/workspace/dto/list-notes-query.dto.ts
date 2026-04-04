import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListNotesQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination (note ID)' })
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

  @ApiPropertyOptional({ description: 'Filter by matter ID' })
  @IsOptional()
  @IsUUID()
  matterId?: string;

  @ApiPropertyOptional({
    description: 'Filter by visibility',
    enum: ['private', 'org'],
  })
  @IsOptional()
  @IsString()
  @IsEnum(['private', 'org'])
  visibility?: string;

  @ApiPropertyOptional({ description: 'Search by title (partial match)' })
  @IsOptional()
  @IsString()
  search?: string;
}
