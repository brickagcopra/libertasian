import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Digests',
};

export default function DigestsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
