import type { HomepageContent } from '../server/homepage-content';

interface FeaturesAccordionProps {
  features: NonNullable<HomepageContent['featuresAccordion']>;
}

export function FeaturesAccordion({ features }: FeaturesAccordionProps) {
  return (
    <section
      className="px-6 py-16 sm:px-10 sm:py-20 lg:py-24"
      style={{ background: 'var(--warm-ink)', color: 'var(--warm-cream)' }}
    >
      <div className="mx-auto max-w-[1320px]">
        <div className="mb-9 flex flex-col items-start gap-3 lg:flex-row lg:items-baseline lg:gap-6">
          <span
            className="uppercase opacity-60"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              letterSpacing: '1px',
            }}
          >
            {features.eyebrow}
          </span>
          <h2
            className="m-0 uppercase"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(36px, 5.5vw, 56px)',
              fontWeight: 500,
              color: 'var(--warm-cream-3)',
              letterSpacing: '-1.8px',
              lineHeight: 1,
            }}
          >
            {features.sectionTitleLine1}
            <br />
            {features.sectionTitleLine2}
            <br />
            {features.sectionTitleLine3}
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1.4fr_1fr] lg:gap-20">
          <div className="flex flex-col">
            {features.items.map((row, i) => {
              const isOpen = !!row.openByDefault;
              return (
                <div
                  key={row.number}
                  className="flex items-start gap-6 px-2 py-6"
                  style={{
                    borderTop: i === 0 ? '1px solid rgba(246,241,232,0.2)' : 'none',
                    borderBottom: '1px solid rgba(246,241,232,0.2)',
                    background: isOpen ? 'var(--warm-accent)' : 'transparent',
                    color: isOpen ? 'var(--warm-surface)' : 'var(--warm-cream)',
                  }}
                >
                  <span
                    className="pt-1.5"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 14,
                      fontWeight: 500,
                      opacity: isOpen ? 1 : 0.6,
                      minWidth: 32,
                    }}
                  >
                    {row.number}
                  </span>
                  <div className="flex-1">
                    <div
                      className="uppercase"
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 'clamp(24px, 3.5vw, 38px)',
                        fontWeight: 500,
                        letterSpacing: '-1.2px',
                        lineHeight: 1.05,
                      }}
                    >
                      {row.label}
                    </div>
                    {isOpen && row.detail && (
                      <p
                        className="mt-3 max-w-[520px]"
                        style={{ fontSize: 14, lineHeight: 1.55, opacity: 0.95 }}
                      >
                        {row.detail}
                      </p>
                    )}
                  </div>
                  <span
                    className="pt-1"
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 28,
                      opacity: isOpen ? 1 : 0.7,
                    }}
                    aria-hidden
                  >
                    {isOpen ? '×' : '+'}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="relative flex items-center justify-center">
            <div
              className="w-full max-w-sm rounded-3xl p-6"
              style={{
                background: 'var(--warm-cream)',
                boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
                transform: 'rotate(-2deg)',
              }}
            >
              <div
                className="uppercase"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--warm-ink-faint)',
                  letterSpacing: '1px',
                }}
              >
                {features.preview.eyebrow}
              </div>
              <h3
                className="mb-1.5 mt-2"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 24,
                  fontWeight: 500,
                  color: 'var(--warm-ink)',
                  letterSpacing: '-0.6px',
                }}
              >
                {features.preview.headline}
              </h3>
              <p
                className="m-0"
                style={{
                  fontSize: 13,
                  color: 'var(--warm-ink-soft)',
                  lineHeight: 1.5,
                }}
              >
                {features.preview.body}
              </p>
              <div className="mt-4 flex gap-1.5">
                {features.preview.progress.map((v, i) => (
                  <div
                    key={i}
                    className="h-2 flex-1 rounded"
                    style={{ background: v ? 'var(--warm-accent)' : 'var(--warm-cream-2)' }}
                  />
                ))}
              </div>
              <div
                className="mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2.5"
                style={{
                  background: 'var(--warm-ink)',
                  color: 'var(--warm-cream)',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {features.preview.ctaText}
              </div>
            </div>

            <div
              className="absolute right-0 top-7 rounded-full px-4 py-2"
              style={{
                background: 'var(--warm-accent)',
                color: 'var(--warm-surface)',
                fontSize: 12,
                fontWeight: 600,
                transform: 'rotate(6deg)',
                boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
              }}
            >
              {features.preview.badgeText}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
