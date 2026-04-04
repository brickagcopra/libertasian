import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

const VALID_USER_ROLES = [
  'student',
  'bar_taker',
  'solo_practitioner',
  'firm_member',
  'legal_editor',
] as const;

export class CompleteOnboardingDto {
  @IsString()
  @IsIn([...VALID_USER_ROLES])
  userRole!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredBarSubjects?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  practiceAreas?: string[];

  @IsOptional()
  @IsBoolean()
  skipped?: boolean;
}
