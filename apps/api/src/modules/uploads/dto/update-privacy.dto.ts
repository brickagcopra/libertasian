import { IsIn, IsString } from 'class-validator';

/**
 * DTO for updating the privacy level of an upload.
 * Per CLAUDE.md: all scans default to 'private'. UI must show explicit toggle
 * for 'editorial_candidate' with a confirmation dialog.
 */
export class UpdatePrivacyDto {
  @IsString()
  @IsIn(['private', 'editorial_candidate'])
  privacyLevel!: string;
}
