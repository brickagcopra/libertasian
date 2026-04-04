import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreatePostDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  textContent!: string;

  @IsOptional()
  @IsUUID()
  mediaId?: string;

  @IsOptional()
  @IsIn(['draft', 'organization', 'public'])
  visibility?: string;
}
