import { IsOptional, IsString, IsUUID } from 'class-validator';

export class IngestionDashboardQueryDto {
  @IsOptional()
  @IsString()
  period?: 'today' | 'week' | 'month' | 'all';
}

export class IngestionCandidatesQueryDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;
}
