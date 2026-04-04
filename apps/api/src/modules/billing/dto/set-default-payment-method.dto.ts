import { IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetDefaultPaymentMethodDto {
  @ApiProperty({ description: 'Payment method ID to set as default' })
  @IsUUID()
  @IsNotEmpty()
  paymentMethodId!: string;
}
