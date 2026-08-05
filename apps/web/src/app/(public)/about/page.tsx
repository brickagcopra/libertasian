import Link from 'next/link';

import { businessInfo } from '@/features/homepage/server/homepage-content';

export const metadata = {
  title: 'About',
  description:
    'About LIBERTASIAN INC., the Philippine company operating the LIBERTASIAN legal research platform.',
};

export default function AboutPage() {
  return (
    <article className="prose prose-headings:font-serif prose-headings:tracking-tight prose-h1:text-4xl prose-h2:text-2xl mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold text-gray-900">About</h1>
      <p className="mt-2 text-sm text-gray-500">Last updated: August 5, 2026</p>
      <p className="mt-4 text-sm text-gray-600">
        {businessInfo.tradeName} is a Philippine legal research platform operated by{' '}
        <strong>{businessInfo.legalName}</strong>, a company organized under the laws of the
        Republic of the Philippines.
      </p>

      <div className="prose prose-gray mt-10 max-w-none text-sm leading-relaxed text-gray-700">
        <Section title="What we do">
          <p>
            {businessInfo.tradeName} makes Philippine legal material searchable and readable. The
            platform provides AI-assisted legal research with citation-grounded answers, case
            digest generation, a codal reader organised by bar subject, study tools for bar
            candidates, and a practice workspace for matter management.
          </p>
          <p>
            Our editorial corpus is built from official and semi-official Philippine government
            legal repositories. Every generated answer is checked against its cited sources
            before it reaches you, and the platform abstains rather than guessing when the
            supporting material is not there.
          </p>
        </Section>

        <Section title="Who we serve">
          <p>
            Law students preparing for the Philippine Bar Examinations, practising lawyers and
            paralegals doing day-to-day research, and small firms that need a shared research
            workspace.
          </p>
        </Section>

        <Section title="What we are not">
          <p>
            {businessInfo.tradeName} is a research tool, not a law firm. AI outputs are provided
            for informational purposes only, are not legal advice, and do not create an
            attorney-client relationship. The practice of law in the Philippines is reserved for
            members of the Philippine Bar. Always consult a qualified Philippine lawyer for legal
            matters.
          </p>
        </Section>

        <Section title="Privacy posture">
          <p>
            The platform is private by default. Your uploads, camera scans and notes are scoped to
            your organisation and never enter our public editorial corpus without your explicit
            consent. We do not use customer data to train models. See the{' '}
            <Link href="/privacy">Privacy Policy</Link> for the full detail, including your rights
            under the Data Privacy Act of 2012 (Republic Act No. 10173).
          </p>
        </Section>

        <Section title="Company details">
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
          <p>
            Full contact details, including our Data Protection Officer, are on the{' '}
            <Link href="/contact">Contact page</Link>.
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
