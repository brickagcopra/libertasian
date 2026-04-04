import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdatePostDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  textContent?: string;

  @IsOptional()
  @IsIn(['draft', 'organization', 'public'])
  visibility?: string;
}
