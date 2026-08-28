import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Body for `POST /billing/authorize`.
 *
 * DELIBERATELY only two fields. The browser tokenizes the card directly
 * against the gateway and sends us the resulting payment-method id — raw card
 * details (number, cvc, expiry) must NEVER appear on this DTO or anywhere else
 * in this API, because that is what keeps us out of full PCI scope. The global
 * validation pipe runs with `forbidNonWhitelisted`, so a client that tried to
 * post card fields here would be rejected outright.
 */
export class AuthorizeSubscriptionDto {
  @ApiProperty({
    description: 'Local Subscription id returned by POST /billing/checkout',
  })
  @IsUUID()
  subscriptionRef!: string;

  @ApiProperty({
    description: 'Gateway payment-method id tokenized in the browser',
    example: 'pm_abc123',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  paymentMethodId!: string;
}
