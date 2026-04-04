import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * DTO for generating a study outline from upload OCR text.
 * Requires Edu plan or higher (enforced at controller level).
 */
export class GenerateOutlineFromUploadDto {
  @IsOptional()
  @IsString()
  @IsIn(['topic_outline', 'case_brief', 'statute_breakdown', 'study_guide'])
  outlineType?: string;
}
