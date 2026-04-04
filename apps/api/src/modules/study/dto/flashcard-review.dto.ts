import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class SubmitFlashcardReviewDto {
  @IsIn(['again', 'hard', 'good', 'easy'])
  response!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  confidence?: number;
}
