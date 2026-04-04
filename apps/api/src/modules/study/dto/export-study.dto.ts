import { IsEnum, IsOptional } from 'class-validator';

export enum ExportFormat {
  PDF = 'pdf',
  DOCX = 'docx',
}

export class ExportStudyQueryDto {
  @IsEnum(ExportFormat)
  @IsOptional()
  format: ExportFormat = ExportFormat.PDF;
}
