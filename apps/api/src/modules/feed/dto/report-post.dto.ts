import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReportPostDto {
  @IsIn(['spam', 'inappropriate', 'harassment', 'misinformation', 'copyright', 'other'])
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}
