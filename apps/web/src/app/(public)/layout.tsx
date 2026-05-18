import { PublicFooter } from '@/components/layout/public-footer';
import { PublicHeader } from '@/components/layout/public-header';

// The (public) routes — blog / pricing / privacy / terms — render inside the
// `.public-warm` scope so every shadcn `Card` / `Input` / `Button` /
// `Badge` / `Separator` automatically picks up the warm-editorial palette
// via overridden CSS variables. The homepage (app/page.tsx) also wraps in
// `public-warm`; the double class is harmless.
export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="public-warm min-h-screen">
      <PublicHeader />

      <main>{children}</main>

      <PublicFooter />
    </div>
  );
}
