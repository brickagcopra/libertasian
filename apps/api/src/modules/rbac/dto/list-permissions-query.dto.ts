import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListPermissionsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by category', example: 'content_management' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Filter by resource', example: 'documents' })
  @IsOptional()
  @IsString()
  resource?: string;
}
