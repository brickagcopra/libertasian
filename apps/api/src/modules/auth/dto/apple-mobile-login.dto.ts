import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class AppleMobileLoginDto {
  @ApiProperty({
    description:
      'Apple identity token (JWT) obtained from the native Sign in with Apple SDK. ' +
      'Verified server-side against Apple JWKS with issuer/audience/expiry checks.',
  })
  @IsString()
  @IsNotEmpty()
  identityToken!: string;

  @ApiProperty({
    required: false,
    description:
      "User's display name. Apple provides it ONLY on first authorization, so the client " +
      'forwards it when available; the server falls back to the email local-part.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fullName?: string;
}
