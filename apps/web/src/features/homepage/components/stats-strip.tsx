import type { HomepageContent } from '../server/homepage-content';

interface StatsStripProps {
  stats: NonNullable<HomepageContent['stats']>;
}

export function StatsStrip({ stats }: StatsStripProps) {
  return (
    <section className="px-6 pb-10 sm:px-10" style={{ background: 'var(--warm-ink)' }}>
      <div className="mx-auto grid max-w-[1320px] grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {stats.items.map((item) => (
          <div
            key={`${item.value}-${item.label}`}
            className="border-t pt-6"
            style={{ borderColor: 'rgba(246,241,232,0.15)' }}
          >
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 56,
                fontWeight: 500,
                color: 'var(--warm-cream-3)',
                letterSpacing: '-1.6px',
                lineHeight: 1,
              }}
            >
              {item.value}
            </div>
            <div
              className="mt-2 uppercase opacity-60"
              style={{
                fontSize: 12,
                color: 'var(--warm-cream)',
                letterSpacing: '0.8px',
              }}
            >
              {item.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
