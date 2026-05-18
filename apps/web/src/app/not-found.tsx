import Link from 'next/link';

import { PublicFooter } from '@/components/layout/public-footer';
import { PublicHeader } from '@/components/layout/public-header';

export default function NotFound() {
  return (
    <div className="public-warm min-h-screen">
      <PublicHeader />

      <main className="flex flex-col items-center justify-center p-24">
        <h1 className="font-serif text-6xl font-medium" style={{ color: 'var(--warm-ink)' }}>
          404
        </h1>
        <p className="mt-4 text-lg" style={{ color: 'var(--warm-ink-mid)' }}>
          Page not found
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ background: 'var(--warm-ink)', color: 'var(--warm-cream)' }}
        >
          Go home <span aria-hidden>→</span>
        </Link>
      </main>

      <PublicFooter />
    </div>
  );
}
