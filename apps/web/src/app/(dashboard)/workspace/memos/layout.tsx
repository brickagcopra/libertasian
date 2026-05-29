import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Legal Memos' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
