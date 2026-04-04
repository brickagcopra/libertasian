import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AskResearchQueryDto {
  @ApiProperty({
    description: 'Research query with workspace context (10-2000 characters)',
    minLength: 10,
    maxLength: 2000,
  })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  query!: string;
}
