import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RevokePromotionRedemptionDto {
  @ApiProperty({ description: 'Reason for revoking the redemption', example: 'Fraudulent activity detected' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
