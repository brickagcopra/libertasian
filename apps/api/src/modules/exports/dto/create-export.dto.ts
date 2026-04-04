import { IsIn, IsString, IsUUID } from 'class-validator';

export class CreateExportDto {
  @IsString()
  @IsIn(['digest', 'memo', 'note'])
  contentType!: string;

  @IsUUID()
  contentId!: string;

  @IsString()
  @IsIn(['pdf', 'docx'])
  format!: string;
}
