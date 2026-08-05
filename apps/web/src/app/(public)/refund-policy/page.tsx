import Link from 'next/link';

import { businessInfo } from '@/features/homepage/server/homepage-content';

export const metadata = {
  title: 'Refund Policy',
  description:
    'Refund eligibility, how to request a refund, and processing times for LIBERTASIAN subscriptions.',
};

export default function RefundPolicyPage() {
  return (
    <article className="prose prose-headings:font-serif prose-headings:tracking-tight prose-h1:text-4xl prose-h2:text-2xl mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold text-gray-900">Refund Policy</h1>
      <p className="mt-2 text-sm text-gray-500">Last updated: August 5, 2026</p>
      <p className="mt-4 text-sm text-gray-600">
        This policy applies to subscriptions to {businessInfo.tradeName}, operated by{' '}
        <strong>{businessInfo.legalName}</strong>. It forms part of our{' '}
        <Link href="/terms">Terms of Service</Link>.
      </p>

      <div className="prose prose-gray mt-10 max-w-none text-sm leading-relaxed text-gray-700">
        <Section title="1. Free trial before you pay">
          <p>
            Every plan has a free tier with no time limit and no card required. We ask you to use
            it before subscribing, because it is the most reliable way to know whether the
            platform suits your work.
          </p>
        </Section>

        <Section title="2. Refund eligibility">
          <ul>
            <li>
              <strong>First paid period — 7 days.</strong> If you are dissatisfied with your first
              paid billing period on an account (a new subscription or an upgrade), you may
              request a full refund within <strong>7 calendar days</strong> of the charge.
            </li>
            <li>
              <strong>Unintended renewal — 7 days.</strong> If a subscription renewed and you did
              not intend to continue, you may request a full refund of that renewal within{' '}
              <strong>7 calendar days</strong> of the renewal charge, provided you have not used
              the service in the new billing period.
            </li>
            <li>
              <strong>Duplicate or erroneous charges.</strong> Refunded in full at any time, with
              no window. If you were billed twice for the same period, or billed after a
              confirmed cancellation, tell us and we will return the money.
            </li>
            <li>
              <strong>Service failure.</strong> If a sustained outage or defect prevented you from
              using a plan feature you paid for, contact us — we will refund or credit the
              affected period.
            </li>
          </ul>
        </Section>

        <Section title="3. What is not refundable">
          <ul>
            <li>
              Billing periods that have already elapsed. Cancelling takes effect at the end of the
              current period and does not refund the period you have already used.
            </li>
            <li>
              Requests made after the 7-day windows above, except for the duplicate-charge and
              service-failure cases in section 2, which have no window.
            </li>
            <li>
              Free-tier usage, which involves no charge and therefore nothing to refund.
            </li>
          </ul>
        </Section>

        <Section title="4. How to request a refund">
          <p>
            Email <a href={`mailto:${businessInfo.email}`}>{businessInfo.email}</a> from the email
            address on the account, with the subject line <strong>Refund request</strong>. Include:
          </p>
          <ul>
            <li>the invoice number (from your receipt email, or Settings → Billing);</li>
            <li>the date and amount of the charge; and</li>
            <li>a one-line reason — it helps us fix the underlying problem.</li>
          </ul>
          <p>
            You can also reach us by phone on{' '}
            <a href={`tel:${businessInfo.phone}`}>{businessInfo.phone}</a> during the support hours
            listed on the <Link href="/contact">Contact page</Link>, but please follow up by email
            so there is a written record of the request.
          </p>
        </Section>

        <Section title="5. Processing time">
          <ul>
            <li>
              <strong>Acknowledgement:</strong> within 1 business day of receiving your request.
            </li>
            <li>
              <strong>Decision:</strong> within 3 business days. If we need more information we
              will say so in that time rather than leaving the request open.
            </li>
            <li>
              <strong>Money returned:</strong> approved refunds are issued to the original payment
              method within 7 to 14 banking days of approval. The exact timing depends on your
              bank, card issuer or e-wallet provider — the delay after we issue the refund is on
              their side, not ours.
            </li>
          </ul>
          <p>
            Refunds are made in Philippine Pesos (PHP) to the original payment method. We cannot
            redirect a refund to a different card, account or e-wallet.
          </p>
        </Section>

        <Section title="6. Effect on your access">
          <p>
            A full refund ends the subscription it covers, and the account returns to the free
            tier immediately. A partial refund does not change your plan or access. Cancelling
            without a refund keeps your access until the end of the period you have paid for.
          </p>
        </Section>

        <Section title="7. Questions">
          <p>
            <strong>{businessInfo.legalName}</strong>
            <br />
            {businessInfo.address.full}
            <br />
            Email: <a href={`mailto:${businessInfo.email}`}>{businessInfo.email}</a>
            <br />
            Phone: <a href={`tel:${businessInfo.phone}`}>{businessInfo.phone}</a>
          </p>
        </Section>
      </div>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}
