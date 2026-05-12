import type { Metadata } from 'next';

import { DashboardShell } from './dashboard-shell';

export const metadata: Metadata = {
  title: 'Admin',
};

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <DashboardShell>{children}</DashboardShell>;
}
