import { IsEmail, IsIn, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InviteMemberDto {
  @ApiProperty({ description: 'Email of the person to invite', example: 'atty.carlos@firm.ph' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({
    description: 'Role to assign',
    enum: ['admin', 'editor', 'member', 'reviewer', 'student'],
  })
  @IsString()
  @IsIn(['admin', 'editor', 'member', 'reviewer', 'student'])
  role!: string;
}
