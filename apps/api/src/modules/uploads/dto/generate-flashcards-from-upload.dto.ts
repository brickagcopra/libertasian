import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/**
 * DTO for generating AI flashcards from upload OCR text.
 * Requires Edu plan or higher (enforced at controller level).
 */
export class GenerateFlashcardsFromUploadDto {
  @IsUUID()
  flashcardSetId!: string;

  @IsOptional()
  @IsString()
  @IsIn(['definition', 'application', 'case_holding', 'provision', 'doctrine', 'procedure', 'mixed'])
  cardType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  count?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  barSubject?: string;
}
