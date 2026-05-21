import type { Metadata } from 'next';

import { DashboardShell } from './dashboard-shell';

export const metadata: Metadata = {
  title: { default: 'Dashboard', template: '%s — LIBERTASIAN' },
};

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <DashboardShell>{children}</DashboardShell>;
}
