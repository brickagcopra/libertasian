import { HttpException, HttpStatus } from '@nestjs/common';

import { PaywallException } from './paywall.exception';

describe('PaywallException', () => {
  it('extends HttpException for global filter compatibility', () => {
    const ex = new PaywallException({ corpus: 'documents' });
    expect(ex).toBeInstanceOf(HttpException);
  });

  it('uses HTTP 402 Payment Required', () => {
    const ex = new PaywallException({ corpus: 'documents' });
    expect(ex.getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
    expect(ex.getStatus()).toBe(402);
  });

  it('serializes with code subscription_required and corpus', () => {
    const body = new PaywallException({ corpus: 'documents' }).getResponse() as Record<
      string,
      unknown
    >;
    expect(body['code']).toBe('subscription_required');
    expect(body['corpus']).toBe('documents');
    expect(body['message']).toBe("This content isn't included in your plan.");
  });

  it('includes previewItemId when provided', () => {
    const body = new PaywallException({
      corpus: 'digests',
      previewItemId: 'item-abc',
    }).getResponse() as Record<string, unknown>;
    expect(body['previewItemId']).toBe('item-abc');
    expect(body['corpus']).toBe('digests');
  });

  it('omits previewItemId when not provided', () => {
    const body = new PaywallException({ corpus: 'derivatives' }).getResponse() as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty('previewItemId');
  });
});
