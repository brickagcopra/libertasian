import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListBookmarksQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination (bookmark ID)' })
  @IsUUID()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({ description: 'Filter by legal document ID' })
  @IsUUID()
  @IsOptional()
  legalDocumentId?: string;
}
