import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Equals, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for `DELETE /users/me`.
 *
 * `confirm` is the typed-confirmation the mobile and web UIs collect; it is
 * validated server-side so a stray client cannot delete an account with an
 * empty body. Ownership is then re-proven with EITHER the password (accounts
 * that have one) or an exact echo of the account email (social-only accounts,
 * which have no password to check).
 */
export class DeleteAccountDto {
  @ApiProperty({
    example: 'DELETE',
    description: 'Must be the literal string DELETE.',
  })
  @Equals('DELETE')
  confirm!: 'DELETE';

  @ApiPropertyOptional({
    description:
      'Current password. Required when the account has a password set.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  password?: string;

  @ApiPropertyOptional({
    description:
      'Exact account email. Required for social-only accounts (no password set).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;
}
