import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Hearing Prep' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
