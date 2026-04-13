import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * One option row to be written into `mcq_options` alongside an
 * `mcq_questions` row. The caller must supply exactly four of these per
 * `createMcqQuestion` call with labels {A, B, C, D} and exactly one
 * `isCorrect: true` — enforced in `DerivativeArtifactService.createMcqQuestion`
 * before the transaction opens.
 *
 * §5.3 content-quality checks (distractor plausibility, rationale cites a
 * source, stem doesn't leak the answer) are NOT enforced here. Those are
 * the `McqQuestionValidator`'s job (§4.4) and run upstream in the generation
 * pipeline before this DTO is ever constructed.
 */
export const MCQ_OPTION_LABELS = ['A', 'B', 'C', 'D'] as const;
export type McqOptionLabel = (typeof MCQ_OPTION_LABELS)[number];

export class McqOptionInputDto {
  @ApiProperty({
    description: 'Option label. Must be one of A, B, C, D; uniqueness per question is enforced at the DB.',
    enum: MCQ_OPTION_LABELS,
  })
  @IsIn(MCQ_OPTION_LABELS as unknown as string[])
  optionLabel!: McqOptionLabel;

  @ApiProperty({ description: 'The option text shown to the student.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  optionText!: string;

  @ApiProperty({ description: 'True if this option is the key. Exactly one per question.' })
  @IsBoolean()
  isCorrect!: boolean;

  @ApiPropertyOptional({
    description:
      'Why this option is right/wrong. Populated by the generator; the ' +
      'validator layer (§4.4) is responsible for checking that the correct ' +
      "option's rationale cites a source section.",
  })
  @IsString()
  @IsOptional()
  @MaxLength(4000)
  rationale?: string;
}
