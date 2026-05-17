import { PublicFooter } from '@/components/layout/public-footer';
import { PublicHeader } from '@/components/layout/public-header';

// The (public) routes (blog/pricing/privacy/terms) keep their existing white
// content backgrounds; only the chrome (header + footer) carries the new warm
// editorial styling. The homepage at app/page.tsx wraps itself in `.public-warm`
// because it is fully redesigned around the bundle.
export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-white">
      <PublicHeader />

      <main>{children}</main>

      <PublicFooter />
    </div>
  );
}
