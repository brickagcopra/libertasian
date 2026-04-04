import { IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class StartStudySessionDto {
  @IsIn(['flashcard_set', 'reviewer_pack', 'codal_subject', 'digest'])
  entityType!: string;

  @IsUUID()
  entityId!: string;

  @IsOptional()
  barSubject?: string;
}

export class EndStudySessionDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  itemsStudied?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  itemsCorrect?: number;
}
