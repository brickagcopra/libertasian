import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListUploadsQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination (upload ID)' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Number of items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Filter by upload type',
    enum: ['document', 'camera_scan'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['document', 'camera_scan'])
  uploadType?: string;

  @ApiPropertyOptional({
    description: 'Filter by processing status',
    enum: ['pending', 'processing', 'completed', 'failed'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['pending', 'processing', 'completed', 'failed'])
  processingStatus?: string;
}
