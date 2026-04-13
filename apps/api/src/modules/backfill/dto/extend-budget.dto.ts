import { IsNumber, Min, IsString, IsNotEmpty } from 'class-validator';

export class ExtendBudgetDto {
  @IsNumber()
  @Min(0.01)
  newCeilingUsd!: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
