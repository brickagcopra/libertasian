import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePlanPriceDto {
  @ApiProperty({
    description: 'Billing interval',
    enum: ['monthly', 'annual', 'quarterly', 'one_time'],
    example: 'monthly',
  })
  @IsString()
  @IsNotEmpty()
  @IsEnum(['monthly', 'annual', 'quarterly', 'one_time'])
  billingInterval!: string;

  @ApiProperty({ description: 'Amount in centavos (PHP)', example: 99900 })
  @IsInt()
  @Min(0)
  amount!: number;

  @ApiPropertyOptional({ description: 'Currency code', default: 'PHP', example: 'PHP' })
  @IsString()
  @IsOptional()
  currency?: string;
}
