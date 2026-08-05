import Link from 'next/link';

import { businessInfo } from '@/features/homepage/server/homepage-content';

export const metadata = {
  title: 'Contact',
  description:
    'Contact details for LIBERTASIAN INC. — registered address, phone, support email and Data Protection Officer.',
};

export default function ContactPage() {
  return (
    <article className="prose prose-headings:font-serif prose-headings:tracking-tight prose-h1:text-4xl prose-h2:text-2xl mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold text-gray-900">Contact</h1>
      <p className="mt-2 text-sm text-gray-500">Last updated: August 5, 2026</p>
      <p className="mt-4 text-sm text-gray-600">
        Every address on this page is monitored. If you are reporting a billing problem, include
        the email address on the account and the invoice number.
      </p>

      <div className="prose prose-gray mt-10 max-w-none text-sm leading-relaxed text-gray-700">
        <Section title="Registered business">
          <p>
            <strong>{businessInfo.legalName}</strong>
            <br />
            {businessInfo.address.street}
            <br />
            {businessInfo.address.city}, {businessInfo.address.province}{' '}
            {businessInfo.address.postalCode}
            <br />
            {businessInfo.address.country}
          </p>
        </Section>

        <Section title="Get in touch">
          <p>
            <strong>Email:</strong>{' '}
            <a href={`mailto:${businessInfo.email}`}>{businessInfo.email}</a>
            <br />
            <strong>Phone:</strong>{' '}
            <a href={`tel:${businessInfo.phone}`}>{businessInfo.phone}</a>
          </p>
          <p>
            <strong>Support hours:</strong> Monday to Friday, 9:00&nbsp;AM to 6:00&nbsp;PM
            Philippine Standard Time (UTC+8), excluding Philippine public holidays. Email is
            monitored daily and we aim to reply within one business day.
          </p>
        </Section>

        <Section title="Data Protection Officer">
          <p>
            For requests under the Data Privacy Act of 2012 (Republic Act No. 10173) — access,
            correction, erasure, objection, or a complaint about how we handle your personal
            information:
          </p>
          <p>
            <strong>{businessInfo.dpo.name}</strong>, Data Protection Officer
            <br />
            <a href={`mailto:${businessInfo.dpo.email}`}>{businessInfo.dpo.email}</a>
          </p>
          <p>
            We respond to data subject requests within 30 days. You may also file a complaint
            with the <strong>National Privacy Commission</strong> of the Philippines at
            privacy.gov.ph.
          </p>
        </Section>

        <Section title="Billing, refunds and cancellation">
          <p>
            Subscription terms, cancellation and refund eligibility are set out in the{' '}
            <Link href="/refund-policy">Refund Policy</Link> and{' '}
            <Link href="/terms">Terms of Service</Link>. Current plans and prices are on the{' '}
            <Link href="/pricing">Pricing page</Link>.
          </p>
        </Section>

        <Section title="Account deletion">
          <p>
            Deleting your account is self-serve and does not require contacting us. The{' '}
            <Link href="/account-deletion">Account &amp; Data Deletion page</Link> explains the
            steps, the 30-day restore window, and what we are required to retain.
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
