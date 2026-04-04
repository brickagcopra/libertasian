import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: 'NewSecurePass456' })
  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters' })
  @MaxLength(128)
  newPassword!: string;
}
