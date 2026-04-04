import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListMembersQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination (member ID)' })
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

  @ApiPropertyOptional({ description: 'Search by name or email', example: 'carlos' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by role slug', example: 'editor' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  roleSlug?: string;
}
