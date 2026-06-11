import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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

  @ApiProperty({
    required: false,
    description:
      'Keep me signed in. Checked/omitted (default) issues a persistent 7-day refresh cookie; ' +
      'false issues a session cookie cleared on browser close. The server-side refresh-token ' +
      'TTL is unchanged either way — only browser cookie persistence differs.',
  })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
