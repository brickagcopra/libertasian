import type { Metadata } from 'next';

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
    <main className="public-warm flex min-h-screen items-center justify-center px-4 py-12">
      {children}
    </main>
  );
}
