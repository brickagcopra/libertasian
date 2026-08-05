import Link from 'next/link';

import {
  businessInfo,
  getHomepageContent,
} from '@/features/homepage/server/homepage-content';

export async function PublicFooter() {
  const content = await getHomepageContent();
  const tagline = content.footer.tagline ?? content.footer.brandDescription;
  const companyLinks = content.footer.companyLinks ?? [];

  return (
    <>
      <div
        className="border-t px-6 py-4"
        style={{ background: 'var(--warm-cream-2)', borderColor: 'var(--warm-line)' }}
      >
        <p
          className="mx-auto max-w-4xl text-center text-xs leading-relaxed"
          style={{ color: 'var(--warm-ink-faint)' }}
        >
          {content.disclaimer}
        </p>
      </div>

      <footer
        className="px-6 pb-10 pt-16 sm:px-10"
        style={{ background: 'var(--warm-ink)', color: 'var(--warm-cream)' }}
      >
        <div className="mx-auto grid max-w-[1320px] gap-10 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <div className="mb-4 flex items-center gap-2.5">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-[10px] text-[22px] font-medium leading-none"
                style={{
                  background: 'var(--warm-accent)',
                  color: 'var(--warm-surface)',
                  fontFamily: 'var(--font-display)',
                }}
              >
                L
              </span>
              <span
                className="text-[28px] font-medium tracking-[-0.6px]"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--warm-cream-3)' }}
              >
                libertasian
              </span>
            </div>
            <p
              className="max-w-xs text-sm leading-relaxed opacity-70"
              style={{ color: 'var(--warm-cream)' }}
            >
              {tagline}
            </p>
            <p className="mt-4 text-sm opacity-70" style={{ color: 'var(--warm-cream)' }}>
              {content.footer.contactEmail}
            </p>
          </div>

          <FooterColumn heading="Product" items={content.footer.productLinks} />
          <FooterColumn heading="Company" items={companyLinks} />
          <FooterColumn heading="Legal" items={content.footer.legalLinks} />
        </div>

        <div
          className="mx-auto mt-10 flex max-w-[1320px] flex-col gap-2 border-t pt-6 text-xs opacity-60 sm:flex-row sm:justify-between"
          style={{ borderColor: 'rgba(246,241,232,0.15)', color: 'var(--warm-cream)' }}
        >
          <span>
            &copy; {new Date().getFullYear()} {businessInfo.legalName} &middot;{' '}
            {businessInfo.address.city}, {businessInfo.address.country}
          </span>
          <span>Made with respect for your time, in the Philippines.</span>
        </div>
      </footer>
    </>
  );
}

function FooterColumn({
  heading,
  items,
}: {
  heading: string;
  items: Array<{ label: string; href: string }>;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p
        className="mb-4 text-[11px] uppercase tracking-[1px] opacity-50"
        style={{ fontFamily: 'var(--font-mono)', color: 'var(--warm-cream)' }}
      >
        {heading}
      </p>
      <ul className="flex flex-col gap-2.5">
        {items.map((link) => (
          <li key={`${heading}-${link.href}-${link.label}`}>
            <Link
              href={link.href}
              className="text-sm opacity-85 transition-opacity hover:opacity-100"
              style={{ color: 'var(--warm-cream)' }}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
