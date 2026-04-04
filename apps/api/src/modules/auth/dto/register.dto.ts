import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'juan@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: 'SecurePass123' })
  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters' })
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: 'Juan Dela Cruz' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fullName!: string;
}
