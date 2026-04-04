import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class AiAnswerQueryDto {
  @IsString()
  @MaxLength(2000)
  query!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxPassages?: number;
}
