import { IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MfaVerifyDto {
  @ApiProperty({ description: 'TOTP code from authenticator app', example: '123456' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  code!: string;
}
