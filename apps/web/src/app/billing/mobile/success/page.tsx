import type { Metadata } from 'next';
import { MobileBounceContent } from '../bounce-content';

export const metadata: Metadata = {
  title: 'Payment Complete — LIBERTASIAN',
};

export default function MobileBillingSuccessPage() {
  return (
    <MobileBounceContent
      title="Payment complete"
      message="Payment complete — return to the LIBERTASIAN app to continue."
      deepLink="libertasian://billing/success"
      buttonLabel="Return to the LIBERTASIAN app"
    />
  );
}
