import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AcceptInviteDto {
  @ApiProperty({ description: 'Invite token received via email' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
