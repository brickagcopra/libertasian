import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class ListExportsQueryDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  @IsIn(['digest', 'memo', 'note'])
  contentType?: string;
}
