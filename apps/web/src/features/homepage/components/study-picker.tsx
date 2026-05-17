import Link from 'next/link';

import type { HomepageContent } from '../server/homepage-content';

interface StudyPickerProps {
  picker: NonNullable<HomepageContent['studyPicker']>;
}

type Tone = NonNullable<HomepageContent['studyPicker']>['items'][number]['tone'];
type Glyph = NonNullable<HomepageContent['studyPicker']>['items'][number]['glyph'];

const TONES: Record<Tone, { bg: string; fg: string }> = {
  accent: { bg: 'var(--warm-accent)', fg: 'var(--warm-surface)' },
  cream: { bg: 'var(--warm-cream-2)', fg: 'var(--warm-ink)' },
  ink: { bg: 'var(--warm-ink)', fg: 'var(--warm-cream-3)' },
  accentSoft: { bg: 'var(--warm-accent-soft)', fg: 'var(--warm-ink)' },
};

function Glyph({ glyph, stroke }: { glyph: Glyph; stroke: string }) {
  switch (glyph) {
    case 'gavel':
      return (
        <svg width="170" height="150" viewBox="0 0 180 160" fill="none" aria-hidden>
          <g transform="rotate(-22 90 90)">
            <rect
              x="40"
              y="74"
              width="100"
              height="26"
              rx="6"
              stroke={stroke}
              strokeWidth="6"
              fill="none"
            />
            <rect
              x="78"
              y="96"
              width="14"
              height="50"
              rx="3"
              stroke={stroke}
              strokeWidth="6"
              fill="none"
            />
            <line x1="55" y1="74" x2="55" y2="100" stroke={stroke} strokeWidth="6" />
            <line x1="125" y1="74" x2="125" y2="100" stroke={stroke} strokeWidth="6" />
          </g>
          <line x1="20" y1="140" x2="160" y2="140" stroke={stroke} strokeWidth="6" strokeLinecap="round" />
        </svg>
      );
    case 'scales':
      return (
        <svg width="170" height="150" viewBox="0 0 180 160" fill="none" aria-hidden>
          <line x1="90" y1="40" x2="90" y2="130" stroke={stroke} strokeWidth="6" strokeLinecap="round" />
          <line x1="40" y1="60" x2="140" y2="60" stroke={stroke} strokeWidth="6" strokeLinecap="round" />
          <line x1="60" y1="130" x2="120" y2="130" stroke={stroke} strokeWidth="6" strokeLinecap="round" />
          <path d="M40 60 L25 100 L55 100 Z" stroke={stroke} strokeWidth="5" fill="none" strokeLinejoin="round" />
          <path d="M140 60 L125 100 L155 100 Z" stroke={stroke} strokeWidth="5" fill="none" strokeLinejoin="round" />
          <circle cx="90" cy="40" r="6" fill={stroke} />
        </svg>
      );
    case 'book':
      return (
        <svg width="170" height="150" viewBox="0 0 180 160" fill="none" aria-hidden>
          <path
            d="M30 40 L90 50 L150 40 L150 130 L90 140 L30 130 Z"
            stroke={stroke}
            strokeWidth="6"
            fill="none"
            strokeLinejoin="round"
          />
          <line x1="90" y1="50" x2="90" y2="140" stroke={stroke} strokeWidth="5" />
          <line x1="46" y1="70" x2="76" y2="74" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
          <line x1="46" y1="86" x2="76" y2="90" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
          <line x1="46" y1="102" x2="76" y2="106" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
          <line x1="104" y1="74" x2="134" y2="70" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
          <line x1="104" y1="90" x2="134" y2="86" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
          <line x1="104" y1="106" x2="134" y2="102" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
        </svg>
      );
    case 'hardhat':
      return (
        <svg width="170" height="150" viewBox="0 0 180 160" fill="none" aria-hidden>
          <path d="M30 110 Q90 40 150 110 Z" stroke={stroke} strokeWidth="6" fill="none" strokeLinejoin="round" />
          <line x1="20" y1="115" x2="160" y2="115" stroke={stroke} strokeWidth="6" strokeLinecap="round" />
          <line x1="90" y1="55" x2="90" y2="115" stroke={stroke} strokeWidth="5" />
          <circle cx="90" cy="50" r="6" stroke={stroke} strokeWidth="4" fill="none" />
          <line x1="60" y1="125" x2="120" y2="125" stroke={stroke} strokeWidth="5" strokeLinecap="round" opacity="0.5" />
        </svg>
      );
  }
}

export function StudyPicker({ picker }: StudyPickerProps) {
  return (
    <section className="px-6 py-16 sm:px-10 sm:py-20" style={{ background: 'var(--warm-cream)' }}>
      <div className="mx-auto max-w-[1320px]">
        <div className="mb-8 flex flex-col items-start gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <h2
            className="m-0 uppercase"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(36px, 5.5vw, 52px)',
              fontWeight: 500,
              color: 'var(--warm-ink)',
              letterSpacing: '-1.6px',
              lineHeight: 1,
            }}
          >
            {picker.sectionTitle}
          </h2>
          <Link
            href={picker.sectionLinkHref}
            className="text-sm transition-opacity hover:opacity-70"
            style={{ color: 'var(--warm-ink-soft)' }}
          >
            {picker.sectionLinkText}
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {picker.items.map((card, i) => {
            const tone = TONES[card.tone];
            return (
              <Link
                key={`${card.label}-${i}`}
                href={picker.sectionLinkHref}
                className="relative flex min-h-[280px] flex-col justify-between rounded-3xl p-6 transition-transform hover:scale-[1.01]"
                style={{ background: tone.bg, color: tone.fg }}
              >
                <div className="absolute right-4 top-4">
                  <Glyph glyph={card.glyph} stroke={tone.fg} />
                </div>
                <div className="self-end opacity-70" style={{ fontSize: 12 }}>
                  {String(i + 1).padStart(2, '0')} / {String(picker.items.length).padStart(2, '0')}
                </div>
                <div>
                  <div
                    className="uppercase"
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 'clamp(28px, 3.5vw, 44px)',
                      fontWeight: 500,
                      letterSpacing: '-1.4px',
                      lineHeight: 1,
                    }}
                  >
                    {card.label}
                  </div>
                  <div className="mt-2 opacity-75" style={{ fontSize: 13 }}>
                    {card.count}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
