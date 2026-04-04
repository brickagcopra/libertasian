import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * DTO for triggering digest generation from an uploaded/scanned document.
 * Per CLAUDE.md: free users get OCR text only; digest generation requires paid plan.
 */
export class GenerateDigestFromUploadDto {
  @IsOptional()
  @IsString()
  @IsIn(['case_digest', 'statute_summary', 'reviewer_note', 'study_digest'])
  digestType?: string;
}
