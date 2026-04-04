import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListCodalsBySubjectQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination' })
  @IsUUID()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Filter by document type',
    enum: ['statute', 'codal', 'executive_order', 'republic_act', 'presidential_decree'],
  })
  @IsIn(['statute', 'codal', 'executive_order', 'republic_act', 'presidential_decree'])
  @IsOptional()
  documentType?: string;

  @ApiPropertyOptional({ description: 'Search term for title' })
  @IsString()
  @IsOptional()
  search?: string;
}
