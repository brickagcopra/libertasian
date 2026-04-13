import { IsString, IsNotEmpty } from 'class-validator';

export class HaltBackfillDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
