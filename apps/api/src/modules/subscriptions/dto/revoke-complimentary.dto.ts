import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RevokeComplimentaryDto {
  @ApiProperty({
    description: 'Reason for revoking complimentary access',
    example: 'Partnership ended',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
