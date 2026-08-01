import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Body for the PUBLIC `POST /users/deletion/restore`.
 *
 * The token is the 64-char hex of 32 random bytes minted at deletion time and
 * emailed to the account owner. It is the only credential — a deactivated
 * account has no session to authenticate with, which is the entire reason this
 * endpoint exists.
 */
export class RestoreAccountDto {
  @ApiProperty({ description: 'Single-use token from the restore email.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token!: string;
}
