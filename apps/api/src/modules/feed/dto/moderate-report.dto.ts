import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ModerateReportDto {
  @IsIn(['dismissed', 'actioned'])
  status!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  resolutionNote?: string;
}
