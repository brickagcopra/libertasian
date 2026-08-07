import type { CSSProperties } from 'react';

import Image from 'next/image';
import Link from 'next/link';

import { businessInfo } from '@/features/homepage/server/homepage-content';

export const metadata = {
  title: 'About',
  description:
    'About LIBERTASIAN INC., the Philippine company operating the LIBERTASIAN legal research platform.',
};

type TeamMember = {
  name: string;
  title: string;
  photo: string;
};

const managementTeam: TeamMember[] = [
  {
    name: 'Jecar John Esling',
    title: 'Chief Executive Officer',
    photo: '/team/jecar-esling.jpg',
  },
  {
    name: 'Brick Demanuel Agcopra',
    title: 'Chief Technology Officer',
    photo: '/team/brick-agcopra.jpg',
  },
  {
    name: 'Mitch Esling',
    title: 'VP for Operations',
    photo: '/team/mitch-esling.jpg',
  },
  {
    name: 'Iris Kristine C. Agcopra',
    title: 'VP for Finance',
    photo: '/team/iris-agcopra.jpg',
  },
];

/**
 * Mono eyebrow label. Sized and tracked to match the homepage sections
 * (contributors.tsx, features-accordion.tsx).
 *
 * Colour is deliberately NOT --warm-ink-faint on the cream ground: that pair
 * measures 2.83:1 and fails WCAG AA for text. --warm-ink-mid on cream is
 * 6.63:1. On the ink plate --warm-ink-faint is 5.46:1 and passes, so it is
 * used there.
 */
const eyebrow: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  letterSpacing: '1px',
};

/**
 * Section heading. Uppercase Fraunces at weight 500 with tight negative
 * tracking is the homepage's h2 register; the size is stepped down from its
 * clamp(36px, 5.5vw, 56px) because this page carries six headings rather than
 * one per full-bleed band.
 */
const displayHeading: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 500,
  letterSpacing: '-1.2px',
  lineHeight: 1,
  fontSize: 'clamp(28px, 3.1vw, 36px)',
  textTransform: 'uppercase',
};

/** The torn-edge divider from contributors.tsx — the house section transition. */
const TORN_EDGE =
  'polygon(0 0, 0 100%, 6% 60%, 12% 100%, 19% 50%, 27% 100%, 35% 55%, 44% 100%, 52% 50%, 60% 100%, 68% 55%, 76% 100%, 84% 50%, 92% 100%, 100% 60%, 100% 0)';

export default function AboutPage() {
  return (
    <div className="bg-warm-cream">
      {/* Masthead */}
      <header className="mx-auto max-w-[1100px] px-6 pb-14 pt-20 sm:px-10 sm:pb-16 sm:pt-24">
        <span className="uppercase text-warm-ink-mid" style={eyebrow}>
          § About
        </span>
        <h1
          className="mt-4 text-warm-ink"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 500,
            fontSize: 'clamp(38px, 6.4vw, 68px)',
            letterSpacing: '-1.8px',
            lineHeight: 0.98,
          }}
        >
          {businessInfo.legalName}
        </h1>
        <p
          className="mt-6 max-w-2xl text-warm-ink-soft"
          style={{ fontSize: 'clamp(16px, 1.5vw, 19px)', lineHeight: 1.6 }}
        >
          {businessInfo.tradeName} is a Philippine legal research platform operated by{' '}
          {businessInfo.legalName}, a company founded in {businessInfo.foundedYear} and organized
          under the laws of the Republic of the Philippines.
        </p>
        <p className="mt-8 uppercase text-warm-ink-mid" style={eyebrow}>
          Last updated: August 5, 2026
        </p>
      </header>

      <Section eyebrow="§ 01" title="What we do">
        <p>
          {businessInfo.tradeName} makes Philippine legal material searchable and readable. The
          platform provides AI-assisted legal research with citation-grounded answers, case digest
          generation, a codal reader organised by bar subject, study tools for bar candidates, and a
          practice workspace for matter management.
        </p>
        <p>
          Our editorial corpus is built from official and semi-official Philippine government legal
          repositories. Every generated answer is checked against its cited sources before it
          reaches you, and the platform abstains rather than guessing when the supporting material
          is not there.
        </p>
      </Section>

      <Section eyebrow="§ 02" title="Who we serve">
        <p>
          Law students preparing for the Philippine Bar Examinations, practising lawyers and
          paralegals doing day-to-day research, and small firms that need a shared research
          workspace.
        </p>
      </Section>

      <Section eyebrow="§ 03" title="What we are not">
        <p>
          {businessInfo.tradeName} is a research tool, not a law firm. AI outputs are provided for
          informational purposes only, are not legal advice, and do not create an attorney-client
          relationship. The practice of law in the Philippines is reserved for members of the
          Philippine Bar. Always consult a qualified Philippine lawyer for legal matters.
        </p>
      </Section>

      <Section eyebrow="§ 04" title="Privacy posture">
        <p>
          The platform is private by default. Your uploads, camera scans and notes are scoped to
          your organisation and never enter our public editorial corpus without your explicit
          consent. We do not use customer data to train models. See the{' '}
          <ProseLink href="/privacy">Privacy Policy</ProseLink> for the full detail, including your
          rights under the Data Privacy Act of 2012 (Republic Act No. 10173).
        </p>
      </Section>

      {/* Management team — ink plate. The portraits carry the page, and the ink
          ground is what lets the mono role labels clear WCAG AA. */}
      <section className="bg-warm-ink">
        <div className="mx-auto max-w-[1100px] px-6 py-16 sm:px-10 sm:py-20 lg:grid lg:grid-cols-[280px_1fr] lg:gap-x-12">
          <div>
            <span className="uppercase text-warm-ink-faint" style={eyebrow}>
              § 05
            </span>
            <h2 className="mt-2 text-warm-cream" style={displayHeading}>
              Management team
            </h2>
          </div>

          <div className="mt-8 lg:mt-0">
            <ul className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-4">
              {managementTeam.map((member) => (
                <li key={member.name}>
                  <Image
                    src={member.photo}
                    alt={`${member.name}, ${member.title}, ${businessInfo.legalName}`}
                    width={640}
                    height={640}
                    sizes="(min-width: 1024px) 200px, (min-width: 640px) 22vw, 44vw"
                    className="aspect-square w-full rounded-xl object-cover ring-1 ring-warm-cream/10"
                  />
                  <p
                    className="mt-4 text-warm-cream"
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontWeight: 500,
                      fontSize: 18,
                      letterSpacing: '-0.3px',
                      lineHeight: 1.25,
                    }}
                  >
                    {member.name}
                  </p>
                  <p className="mt-1.5 uppercase text-warm-ink-faint" style={eyebrow}>
                    {member.title}
                  </p>
                </li>
              ))}
            </ul>

            <p
              className="mt-10 border-t pt-5 text-[15px] leading-relaxed text-warm-cream-2"
              style={{ borderColor: 'rgba(246, 241, 232, 0.16)' }}
            >
              {businessInfo.dpo.name} also serves as our Data Protection Officer.
            </p>
          </div>
        </div>
      </section>

      {/* Registered particulars. Torn edge carries the ink plate into the cream
          ground, the same transition contributors.tsx uses. */}
      <section className="relative bg-warm-cream">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[30px] lg:h-[60px]"
          style={{ background: 'var(--warm-ink)', clipPath: TORN_EDGE }}
          aria-hidden
        />
        <div className="mx-auto max-w-[1100px] px-6 pb-20 pt-20 sm:px-10 sm:pb-24 lg:grid lg:grid-cols-[280px_1fr] lg:gap-x-12 lg:pt-28">
          <div>
            <span className="uppercase text-warm-ink-mid" style={eyebrow}>
              § 06
            </span>
            <h2 className="mt-2 text-warm-ink" style={displayHeading}>
              Company details
            </h2>
          </div>

          <div className="mt-8 max-w-2xl lg:mt-0">
            <address className="not-italic">
              <span
                className="block text-warm-ink"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 500,
                  fontSize: 20,
                  letterSpacing: '-0.3px',
                }}
              >
                {businessInfo.legalName}
              </span>
              <span className="mt-3 block text-base leading-[1.7] text-warm-ink-mid">
                {businessInfo.address.street}
                <br />
                {businessInfo.address.city}, {businessInfo.address.province}{' '}
                {businessInfo.address.postalCode}
                <br />
                {businessInfo.address.country}
              </span>
            </address>
            <p className="mt-6 text-[15px] leading-relaxed text-warm-ink-mid">
              Full contact details, including our Data Protection Officer, are on the{' '}
              <ProseLink href="/contact">Contact page</ProseLink>.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function Section({
  eyebrow: label,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t" style={{ borderColor: 'var(--warm-line)' }}>
      <div className="mx-auto max-w-[1100px] px-6 py-14 sm:px-10 sm:py-16 lg:grid lg:grid-cols-[280px_1fr] lg:gap-x-12 lg:py-20">
        <div>
          <span className="uppercase text-warm-ink-mid" style={eyebrow}>
            {label}
          </span>
          <h2 className="mt-2 text-warm-ink" style={displayHeading}>
            {title}
          </h2>
        </div>
        <div className="mt-4 max-w-2xl space-y-4 text-base leading-[1.7] text-warm-ink-mid lg:mt-0">
          {children}
        </div>
      </div>
    </section>
  );
}

/**
 * Body link. The text stays --warm-ink (15.46:1) and the accent is spent on
 * the underline instead: --warm-accent as text on cream is 2.75:1 and would
 * fail AA.
 */
function ProseLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-warm-ink underline decoration-warm-accent decoration-2 underline-offset-4 transition-colors hover:decoration-warm-accent-deep"
    >
      {children}
    </Link>
  );
}
