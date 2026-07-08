import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UnregisterPushTokenDto {
  @ApiProperty({ description: 'Expo push token to unregister' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  token!: string;
}
