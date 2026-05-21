import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  // No min-10 here — accounts created before the policy bump may hold a
  // shorter hash, and we still need to let those users authenticate to
  // upgrade. Bcrypt comparison in the service is the real check.
  @ApiProperty({ description: 'The user\'s current password (for re-authentication).' })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ example: 'NewSecurePass456', description: 'New password — min 10 chars.' })
  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters' })
  @MaxLength(128)
  newPassword!: string;
}
