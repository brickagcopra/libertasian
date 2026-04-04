'use client';

import { useState } from 'react';
import { AuthGuard } from '@/features/auth/components/auth-guard';
import { AppSidebar, SidebarContent } from '@/components/layout/app-sidebar';
import { Header } from '@/components/layout/header';
import { Sheet, SheetContent } from '@/components/ui/sheet';

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <AuthGuard>
      <div className="flex h-screen">
        {/* Desktop sidebar */}
        <AppSidebar />

        {/* Mobile sidebar (Sheet) */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-64 p-0">
            <div onClick={() => setMobileOpen(false)}>
              <SidebarContent />
            </div>
          </SheetContent>
        </Sheet>

        <div className="flex flex-1 flex-col overflow-hidden">
          <Header onMenuClick={() => setMobileOpen(true)} />
          <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}
