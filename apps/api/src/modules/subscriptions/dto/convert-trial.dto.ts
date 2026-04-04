import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConvertTrialDto {
  @ApiProperty({
    description: 'Billing period for the paid subscription',
    example: 'monthly',
    enum: ['monthly', 'annual'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['monthly', 'annual'])
  billingPeriod!: string;
}
