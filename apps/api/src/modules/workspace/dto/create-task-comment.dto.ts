import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTaskCommentDto {
  @ApiProperty({ description: 'Comment body text', maxLength: 5000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body!: string;
}
