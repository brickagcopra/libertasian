import { HttpException, HttpStatus } from '@nestjs/common';

export interface PaywallExceptionDetail {
  corpus: string;
  previewItemId?: string;
}

/**
 * Thrown when a free-tier or anonymous caller hits an item beyond their
 * preview cap. Status 402 Payment Required. Web layer reads `code` to route
 * the user into the upgrade flow.
 *
 * `message` names no tier, no price, and no purchase action — App Review
 * 2.1(b). The mobile client discards this body anyway (see api-client), but
 * the string is the fallback wherever a raw body reaches a user.
 */
export class PaywallException extends HttpException {
  constructor(detail: PaywallExceptionDetail) {
    super(
      {
        code: 'subscription_required',
        message: "This content isn't included in your plan.",
        corpus: detail.corpus,
        ...(detail.previewItemId ? { previewItemId: detail.previewItemId } : {}),
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
