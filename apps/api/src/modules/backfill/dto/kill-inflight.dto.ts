import { IsString, IsNotEmpty } from 'class-validator';

export class KillInflightDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsString()
  @IsNotEmpty()
  confirmName!: string;
}
