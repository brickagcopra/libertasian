import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePlanPriceDto {
  @ApiPropertyOptional({ description: 'Amount in centavos (PHP)', example: 99900 })
  @IsInt()
  @IsOptional()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ description: 'Whether the price is active', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
