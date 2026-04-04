import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'juan@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: 'SecurePass123' })
  @IsString()
  @IsNotEmpty()
  password!: string;

  @ApiProperty({ required: false, description: 'TOTP code if MFA is enabled' })
  @IsOptional()
  @IsString()
  mfaCode?: string;
}
