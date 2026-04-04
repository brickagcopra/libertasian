import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PauseSubscriptionDto {
  @ApiPropertyOptional({
    description: 'Reason for pausing the subscription',
    example: 'Taking a break from the platform',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}
