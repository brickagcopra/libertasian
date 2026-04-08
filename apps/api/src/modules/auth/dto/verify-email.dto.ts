import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailDto {
  @ApiProperty({ description: 'Email address to verify' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ description: '6-digit verification code sent to email' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'Code must be exactly 6 digits' })
  code!: string;
}

export class ResendVerificationDto {
  @ApiProperty({ description: 'Email address to resend verification code to' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}
