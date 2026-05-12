'use client';

import { useState } from 'react';

import { AuthGate } from '@/components/auth-gate';
import { AppSidebar, SidebarContent } from '@/components/layout/app-sidebar';
import { Header } from '@/components/layout/header';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { AuthGuard } from '@/features/auth/components/auth-guard';

export function DashboardShell({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <AuthGuard>
      <AuthGate
        fallback={
          <div className="flex h-screen items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-800" />
          </div>
        }
      >
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
      </AuthGate>
    </AuthGuard>
  );
}
