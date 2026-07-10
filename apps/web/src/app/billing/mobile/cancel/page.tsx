import type { Metadata } from 'next';
import { MobileBounceContent } from '../bounce-content';

export const metadata: Metadata = {
  title: 'Payment Cancelled — LIBERTASIAN',
};

export default function MobileBillingCancelPage() {
  return (
    <MobileBounceContent
      title="Payment cancelled"
      message="No charges were made — return to the LIBERTASIAN app to try again."
      deepLink="libertasian://billing/cancel"
      buttonLabel="Return to the LIBERTASIAN app"
    />
  );
}
