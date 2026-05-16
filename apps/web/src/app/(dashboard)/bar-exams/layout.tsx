import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Bar Exams',
  description:
    'Browse past Philippine Bar examination question papers (2006-2022) ' +
    'sourced from LawPhil.',
};

export default function BarExamsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
