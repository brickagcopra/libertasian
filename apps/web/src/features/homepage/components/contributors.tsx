import Link from 'next/link';

import type { HomepageContent } from '../server/homepage-content';

interface ContributorsProps {
  contributors: NonNullable<HomepageContent['contributors']>;
}

type Tone = NonNullable<HomepageContent['contributors']>['items'][number]['tone'];

const PALETTES: Record<Tone, [string, string]> = {
  sage: ['#7A8B6F', '#3F4F36'],
  plum: ['#8B5E83', '#3F2A45'],
  warm: ['#C77B3D', '#7A4423'],
  cool: ['#4A5D7E', '#1F2A44'],
};

export function Contributors({ contributors }: ContributorsProps) {
  return (
    <section
      className="relative px-6 pb-6 pt-20 sm:px-10 sm:pt-24"
      style={{ background: 'var(--warm-cream)' }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[30px] lg:h-[60px]"
        style={{
          background: 'var(--warm-ink)',
          clipPath:
            'polygon(0 0, 0 100%, 6% 60%, 12% 100%, 19% 50%, 27% 100%, 35% 55%, 44% 100%, 52% 50%, 60% 100%, 68% 55%, 76% 100%, 84% 50%, 92% 100%, 100% 60%, 100% 0)',
        }}
        aria-hidden
      />

      <div className="mx-auto max-w-[1320px] pt-8">
        <div className="mb-9 flex flex-col items-start gap-3 sm:flex-row sm:items-baseline sm:gap-6">
          <span
            className="uppercase"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              letterSpacing: '1px',
              // --warm-ink-faint (#9a8f7c) on this section's --warm-cream
              // ground is 2.83:1 and fails WCAG AA for text. --warm-ink-mid
              // is 6.63:1 on the same ground. The /about page eyebrows use
              // --warm-ink-mid on cream for this reason.
              color: 'var(--warm-ink-mid)',
            }}
          >
            {contributors.eyebrow}
          </span>
          <h2
            className="m-0 uppercase"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(36px, 5.5vw, 56px)',
              fontWeight: 500,
              color: 'var(--warm-ink)',
              letterSpacing: '-1.8px',
              lineHeight: 1,
            }}
          >
            {contributors.sectionTitleLine1}
            <br />
            {contributors.sectionTitleLine2}
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {contributors.items.map((p, i) => {
            const [a, b] = PALETTES[p.tone];
            return (
              <div
                key={`${p.name}-${i}`}
                className="overflow-hidden rounded-3xl border"
                style={{ background: 'var(--warm-surface)', borderColor: 'var(--warm-line)' }}
              >
                <div
                  className="relative h-60"
                  style={{ background: `linear-gradient(155deg, ${a} 0%, ${b} 100%)` }}
                  aria-hidden
                >
                  <div
                    className="absolute inset-0 opacity-[0.18]"
                    style={{
                      backgroundImage:
                        'repeating-linear-gradient(45deg, rgba(255,255,255,0.4) 0 1px, transparent 1px 8px)',
                    }}
                  />
                  <div
                    className="absolute inset-0 opacity-50"
                    style={{
                      background:
                        'radial-gradient(120% 80% at 30% 20%, rgba(255,255,255,0.2), transparent 60%), radial-gradient(80% 60% at 80% 90%, rgba(0,0,0,0.4), transparent 60%)',
                    }}
                  />
                </div>
                <div className="p-5">
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 22,
                      fontWeight: 500,
                      color: 'var(--warm-ink)',
                      letterSpacing: '-0.4px',
                    }}
                  >
                    {p.name}
                  </div>
                  <div className="mt-1 text-sm" style={{ color: 'var(--warm-ink-mid)' }}>
                    {p.role}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 flex justify-center">
          <Link
            href={contributors.ctaHref}
            className="inline-flex h-12 items-center gap-2 rounded-full px-6 text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ background: 'var(--warm-ink)', color: 'var(--warm-cream)' }}
          >
            {contributors.ctaText}
          </Link>
        </div>
      </div>
    </section>
  );
}
