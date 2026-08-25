import { HttpException, HttpStatus } from '@nestjs/common';

export interface PaywallExceptionDetail {
  corpus: string;
  previewItemId?: string;
}

/**
 * Thrown when an anonymous or non-entitled caller hits an item beyond their
 * preview cap. Status 402 Payment Required. Callers branch on the
 * machine-readable `code`, which is unchanged.
 *
 * `message` names no tier, no price and no purchase action — App Review
 * 3.1.1/2.1(b). The mobile client discards this body anyway (see api-client),
 * but the string is the fallback wherever a raw body reaches a user.
 *
 * While PAYWALL_ENFORCED=false this path is unreachable for authenticated
 * callers: getEntitlements() no longer returns previewOnly for anyone.
 */
export class PaywallException extends HttpException {
  constructor(detail: PaywallExceptionDetail) {
    super(
      {
        code: 'subscription_required',
        message: "This isn't available on this account.",
        corpus: detail.corpus,
        ...(detail.previewItemId ? { previewItemId: detail.previewItemId } : {}),
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
