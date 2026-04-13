import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListSubjectsQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(['study_8', 'bar_admin_6'])
  taxonomy?: string;
}
