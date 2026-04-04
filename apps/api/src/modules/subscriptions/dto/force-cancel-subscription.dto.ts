import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForceCancelSubscriptionDto {
  @ApiProperty({
    description: 'Reason for force-cancelling the subscription',
    example: 'Violation of terms of service',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
