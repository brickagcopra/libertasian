import { IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CancelSubscriptionDto {
  @ApiProperty({
    description: 'If true, cancels at end of current billing period instead of immediately',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  cancelAtPeriodEnd?: boolean = true;
}
