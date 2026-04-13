import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { CreateDerivativeArtifactDto } from './create-derivative-artifact.dto';

/**
 * Input DTO for `DerivativeArtifactService.createEssayPrompt`.
 *
 * Composes the base `CreateDerivativeArtifactDto` via `OmitType`, dropping
 * the two base fields the essay-prompt path owns itself:
 *
 *   - `derivativeType` — forced to `'essay_prompt'` by the service.
 *   - `contentJson`    — the service builds the §5.4 output-schema payload
 *     from the structured essay prompt fields on this DTO and writes it
 *     into the base artifact row itself.
 *
 * Every other base invariant still applies: `contentHash`, `contentRights`,
 * `contentDisclaimerId`, `provenanceRecords` (§4.5, `ArrayMinSize(1)`), etc.
 */
export class CreateEssayPromptDto extends OmitType(CreateDerivativeArtifactDto, [
  'derivativeType',
  'contentJson',
] as const) {
  @ApiProperty({
    description:
      'The essay prompt text (fact pattern or question). Service rejects ' +
      'empty strings before opening the transaction.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(16000)
  promptText!: string;

  @ApiPropertyOptional({
    description:
      'Suggested answering time in minutes (15–90). Used for timed ' +
      'practice mode in the student UI.',
  })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(90)
  suggestedTimeMinutes?: number;

  @ApiPropertyOptional({
    description:
      'Structured model answer (e.g., IRAC outline). Stored in both ' +
      'the child row and the base `contentJson` for rendering.',
  })
  @IsOptional()
  @IsObject()
  modelAnswerJson?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Scoring criteria / rubric. If `criteria` array is present with ' +
      '`maxPoints` and `totalPoints`, the service validates that the ' +
      'criteria maxPoints sum to totalPoints.',
  })
  @IsOptional()
  @IsObject()
  rubricJson?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'SubjectTopic UUID. Kept as a raw column for now — the `SubjectTopic` ' +
      'Prisma relation lands with the subjects-seeding PR (PR 1.3). ' +
      'Validation here only ensures the value is a UUID if supplied.',
  })
  @IsUUID()
  @IsOptional()
  subjectTopicId?: string;

  @ApiPropertyOptional({
    description:
      'BarExamSitting UUID. The service verifies that this row exists ' +
      'inside the transaction before creating the essay prompt.',
  })
  @IsUUID()
  @IsOptional()
  barExamSittingId?: string;
}
