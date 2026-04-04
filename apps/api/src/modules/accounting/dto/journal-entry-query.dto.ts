import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class JournalEntryQueryDto {
  @IsOptional()
  @IsUUID()
  period?: string;

  @IsOptional()
  @IsEnum(['DRAFT', 'POSTED', 'VOID'])
  status?: string;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
