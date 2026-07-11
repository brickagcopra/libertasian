import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class GoogleMobileLoginDto {
  @ApiProperty({
    description:
      'Google ID token obtained from the native Google Sign-In SDK. Verified server-side ' +
      'against the web/iOS/Android client-ID audience allowlist.',
  })
  @IsString()
  @IsNotEmpty()
  idToken!: string;
}
