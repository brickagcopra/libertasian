import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MfaDisableDto {
  @ApiProperty({ description: 'Current password to confirm MFA disable' })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  password!: string;
}
