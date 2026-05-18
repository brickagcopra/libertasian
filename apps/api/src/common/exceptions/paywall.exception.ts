import { HttpException, HttpStatus } from '@nestjs/common';

export interface PaywallExceptionDetail {
  corpus: string;
  previewItemId?: string;
}

/**
 * Thrown when a free-tier or anonymous caller hits an item beyond their
 * preview cap. Status 402 Payment Required. Web layer reads `code` to route
 * the user into the upgrade flow.
 */
export class PaywallException extends HttpException {
  constructor(detail: PaywallExceptionDetail) {
    super(
      {
        code: 'subscription_required',
        message: 'Upgrade your plan to access the full corpus.',
        corpus: detail.corpus,
        ...(detail.previewItemId ? { previewItemId: detail.previewItemId } : {}),
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
