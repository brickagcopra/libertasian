import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { CreateDerivativeArtifactDto } from './create-derivative-artifact.dto';
import { McqOptionInputDto } from './mcq-option-input.dto';

/**
 * Input DTO for `DerivativeArtifactService.createMcqQuestion`.
 *
 * Composes the base `CreateDerivativeArtifactDto` from PR b482168 via
 * `OmitType`, dropping the two base fields the MCQ path owns itself:
 *
 *   - `derivativeType` — forced to `'mcq_question'` by the service. Callers
 *     do not pass it, so we drop it from the DTO to avoid accidentally
 *     letting the wrong value slip through.
 *   - `contentJson`    — the service builds the §5.3 output-schema payload
 *     from the structured MCQ fields on this DTO and writes it into the
 *     base artifact row itself. Callers pass the structured fields, not
 *     the JSON blob.
 *
 * Every other base invariant still applies: `contentHash`, `contentRights`,
 * `contentDisclaimerId`, `provenanceRecords` (§4.5, `ArrayMinSize(1)`), etc.
 */
export const MCQ_DIFFICULTIES = [
  'easy',
  'medium',
  'hard',
  'bar_exam_level',
] as const;
export type McqDifficulty = (typeof MCQ_DIFFICULTIES)[number];

export const MCQ_QUESTION_FORMATS = [
  'single_best',
  'multi_select',
  'true_false',
] as const;
export type McqQuestionFormat = (typeof MCQ_QUESTION_FORMATS)[number];

export class CreateMcqQuestionDto extends OmitType(CreateDerivativeArtifactDto, [
  'derivativeType',
  'contentJson',
] as const) {
  @ApiProperty({
    description:
      'The question stem (fact pattern or rule question). Service rejects ' +
      'empty strings before opening the transaction.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  questionStem!: string;

  @ApiProperty({
    description:
      'Explanation of the correct answer. Required by the service — the ' +
      'validator layer (§4.4) will additionally check that it cites at ' +
      'least one source section, but persistence-layer requires only that ' +
      'it is present and non-empty.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  explanation!: string;

  @ApiPropertyOptional({
    description: 'Question difficulty bucket. Defaults to `medium`.',
    enum: MCQ_DIFFICULTIES,
  })
  @IsIn(MCQ_DIFFICULTIES as unknown as string[])
  @IsOptional()
  difficulty?: McqDifficulty;

  @ApiPropertyOptional({
    description: 'Question format. Defaults to `single_best`.',
    enum: MCQ_QUESTION_FORMATS,
  })
  @IsIn(MCQ_QUESTION_FORMATS as unknown as string[])
  @IsOptional()
  questionFormat?: McqQuestionFormat;

  @ApiPropertyOptional({
    description:
      'SubjectTopic UUID. Kept as a raw column for now — the `SubjectTopic` ' +
      'Prisma relation lands with the subjects-seeding PR. Validation here ' +
      'only ensures the value is a UUID if supplied.',
  })
  @IsUUID()
  @IsOptional()
  subjectTopicId?: string;

  @ApiPropertyOptional({
    description:
      'Self-reported difficulty from the generator. Stored in the base ' +
      "row's `contentJson.difficultySelfReport` for §5.3 round-tripping. " +
      'This is distinct from `difficulty`, which is the persisted ' +
      "column used for querying; `difficulty` defaults to this value when " +
      'the service builds `contentJson` if the caller does not supply both.',
    enum: MCQ_DIFFICULTIES,
  })
  @IsIn(MCQ_DIFFICULTIES as unknown as string[])
  @IsOptional()
  difficultySelfReport?: McqDifficulty;

  @ApiPropertyOptional({
    description:
      'UUIDs of the source sections that support the correct answer. ' +
      'Stored in `contentJson.supportingSectionIds`. The validator layer ' +
      '(§4.4) checks that each ID resolves; this DTO only checks shape.',
  })
  @IsArray()
  @IsOptional()
  @IsUUID('4', { each: true })
  supportingSectionIds?: string[];

  @ApiProperty({
    description:
      'Exactly four options with labels A/B/C/D and exactly one ' +
      '`isCorrect: true`. The service enforces these invariants before ' +
      'opening the transaction; DTO-layer only bounds the array length.',
    type: [McqOptionInputDto],
  })
  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => McqOptionInputDto)
  options!: McqOptionInputDto[];
}
