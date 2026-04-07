import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class VoidJournalEntryDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  reason!: string;
}
