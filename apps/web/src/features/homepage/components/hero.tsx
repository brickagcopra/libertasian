import Link from 'next/link';

import { Owl } from '@/components/brand/owl';

import type { HomepageContent } from '../server/homepage-content';

interface HeroProps {
  hero: HomepageContent['hero'];
}

export function Hero({ hero }: HeroProps) {
  const warm = hero.warm;
  if (!warm) return null;

  const primary = warm.primaryCta ?? hero.primaryCta;
  const secondary = warm.secondaryCta ?? hero.secondaryCta;

  return (
    <section
      className="relative overflow-hidden"
      style={{ background: 'var(--warm-accent)' }}
    >
      {/* Desktop (lg+) — absolute-positioned chunky display layout from the bundle. */}
      <div className="hidden lg:block">
        <div
          className="relative mx-auto px-10"
          style={{ maxWidth: 1320, minHeight: 780, paddingTop: 40 }}
        >
          <h1
            className="absolute m-0 uppercase"
            style={{
              top: 30,
              left: 0,
              fontFamily: 'var(--font-display)',
              color: 'var(--warm-cream-3)',
              fontSize: 168,
              lineHeight: 0.86,
              fontWeight: 500,
              letterSpacing: '-5.2px',
              zIndex: 2,
            }}
          >
            {warm.headlineTop.split(' ').slice(0, 1).join(' ')}
            <br />
            {warm.headlineTop.split(' ').slice(1).join(' ')}
          </h1>

          <div
            className="absolute"
            style={{
              top: 30,
              right: 0,
              background: 'var(--warm-ink)',
              color: 'var(--warm-cream)',
              borderRadius: 28,
              padding: '20px 24px',
              maxWidth: 360,
              zIndex: 4,
            }}
          >
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{warm.speechBubble}</p>
            <svg
              width="32"
              height="24"
              viewBox="0 0 32 24"
              style={{ position: 'absolute', left: 28, bottom: -16 }}
              aria-hidden
            >
              <path d="M0 0 L20 0 L8 22 Z" fill="var(--warm-ink)" />
            </svg>
          </div>

          <div
            className="absolute"
            style={{
              top: 30,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 3,
            }}
          >
            <Owl size={560} />
          </div>

          <div
            className="absolute"
            style={{ left: 0, bottom: 110, zIndex: 2, maxWidth: 360 }}
          >
            <p
              className="mb-4"
              style={{
                fontSize: 15,
                lineHeight: 1.55,
                color: 'var(--warm-ink)',
                fontWeight: 500,
              }}
            >
              {warm.body}
            </p>
          </div>

          <h2
            className="absolute m-0 text-right uppercase italic"
            style={{
              right: 0,
              bottom: 100,
              fontFamily: 'var(--font-display)',
              color: 'var(--warm-cream-3)',
              fontSize: 168,
              lineHeight: 0.86,
              fontWeight: 500,
              letterSpacing: '-5px',
              zIndex: 2,
            }}
          >
            {warm.headlineBottom.split(' ').slice(0, 1).join(' ')}
            <br />
            {warm.headlineBottom.split(' ').slice(1).join(' ')}
          </h2>
        </div>
      </div>

      {/* Tablet (md–lg) and mobile (< md) — stacked, smaller display type. */}
      <div className="lg:hidden">
        <div className="relative mx-auto flex flex-col items-center px-6 pt-10 text-center sm:px-10">
          <h1
            className="m-0 uppercase"
            style={{
              fontFamily: 'var(--font-display)',
              color: 'var(--warm-cream-3)',
              fontWeight: 500,
              fontSize: 'clamp(56px, 12vw, 96px)',
              lineHeight: 0.92,
              letterSpacing: '-2.5px',
            }}
          >
            {warm.headlineTop}
          </h1>

          <div className="mt-4 w-full max-w-xs sm:max-w-sm">
            <Owl size={280} />
          </div>

          <h2
            className="m-0 uppercase italic"
            style={{
              fontFamily: 'var(--font-display)',
              color: 'var(--warm-cream-3)',
              fontWeight: 500,
              fontSize: 'clamp(56px, 12vw, 96px)',
              lineHeight: 0.92,
              letterSpacing: '-2.5px',
            }}
          >
            {warm.headlineBottom}
          </h2>

          <div
            className="mt-6 max-w-md rounded-3xl px-5 py-4 text-left"
            style={{ background: 'var(--warm-ink)', color: 'var(--warm-cream)' }}
          >
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{warm.speechBubble}</p>
          </div>

          <p
            className="mt-6 max-w-md"
            style={{
              fontSize: 15,
              lineHeight: 1.55,
              color: 'var(--warm-ink)',
              fontWeight: 500,
            }}
          >
            {warm.body}
          </p>
        </div>
      </div>

      <div
        className="absolute inset-x-0 bottom-0 h-[80px] lg:h-[140px]"
        style={{
          background: 'var(--warm-ink)',
          borderTopLeftRadius: '50% 100%',
          borderTopRightRadius: '50% 100%',
        }}
        aria-hidden
      />

      <div className="relative mx-auto flex max-w-[1320px] flex-col gap-3 px-6 pb-14 pt-12 sm:flex-row sm:px-10 lg:pt-0">
        <Link
          href={primary.href}
          className="inline-flex h-14 items-center justify-center gap-2 rounded-full px-7 text-base font-semibold transition-opacity hover:opacity-90"
          style={{ background: 'var(--warm-cream)', color: 'var(--warm-ink)' }}
        >
          {primary.text}
        </Link>
        <Link
          href={secondary.href}
          className="inline-flex h-14 items-center justify-center gap-2 rounded-full border-[1.5px] bg-transparent px-7 text-base font-semibold transition-opacity hover:opacity-80"
          style={{ borderColor: 'var(--warm-cream)', color: 'var(--warm-cream)' }}
        >
          {secondary.text}
        </Link>
      </div>
    </section>
  );
}
