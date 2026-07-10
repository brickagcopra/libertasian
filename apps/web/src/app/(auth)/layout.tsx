import type { Metadata } from 'next';

import { HeaderGlow } from '@/components/layout/header-glow';

export const metadata: Metadata = {
  title: 'Account',
};

// `public-warm` brings the warm-editorial palette to every shadcn primitive
// rendered by the child auth pages — Cards, Inputs, Buttons, Alerts, Separators
// — without touching their source files.
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="public-warm relative flex min-h-screen items-center justify-center px-4 py-12">
      {/* Ambient top-of-viewport glow band — decorative, behind the card. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-40 overflow-hidden"
      >
        <HeaderGlow />
      </div>
      <div className="relative z-10 flex w-full justify-center">{children}</div>
    </main>
  );
}
