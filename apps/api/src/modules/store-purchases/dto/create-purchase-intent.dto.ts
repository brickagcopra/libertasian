import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import { STORE_PROVIDERS, type StoreProviderSlug } from '../store-purchase-provider.interface';

/**
 * Body for `POST /store/purchase-intent`.
 *
 * Deliberately near-empty: the org and the user come from the JWT, and the
 * product list comes from STORE_PRODUCT_MAP (D7). A client cannot name a plan,
 * a price or a product here — if it could, the "only `pro` and `edu` are sold
 * as IAP" guarantee would become a request parameter.
 *
 * The global ValidationPipe runs `whitelist` + `forbidNonWhitelisted`, so a
 * client that posted anything else would be rejected with a 400 rather than
 * having it silently ignored.
 */
export class CreatePurchaseIntentDto {
  @ApiPropertyOptional({
    description: 'Which store the device will purchase through. Telemetry only.',
    enum: STORE_PROVIDERS,
  })
  @IsOptional()
  @IsIn([...STORE_PROVIDERS])
  store?: StoreProviderSlug;
}
