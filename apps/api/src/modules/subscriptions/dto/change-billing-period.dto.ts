import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangeBillingPeriodDto {
  @ApiProperty({
    description: 'New billing period',
    enum: ['monthly', 'annual'],
    example: 'annual',
  })
  @IsString()
  @IsIn(['monthly', 'annual'])
  billingPeriod!: 'monthly' | 'annual';
}
