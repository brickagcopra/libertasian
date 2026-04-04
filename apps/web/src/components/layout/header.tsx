'use client';

import { useAuthStore } from '@/stores/auth-store';
import { useLogout } from '@/features/auth/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { NotificationBell } from '@/components/layout/notification-bell';
import { LogOutIcon, SettingsIcon, UserIcon, MenuIcon } from 'lucide-react';
import Link from 'next/link';

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();

  const initials = user?.fullName
    ? user.fullName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '?';

  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-4 md:px-6">
      <div className="flex items-center gap-2">
        {onMenuClick && (
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={onMenuClick}
            aria-label="Open menu"
          >
            <MenuIcon />
          </Button>
        )}
        <Separator orientation="vertical" className="mr-2 h-4 md:hidden" />
        <span className="text-sm font-medium text-muted-foreground">Dashboard</span>
      </div>

      <div className="flex items-center gap-2">
        {user && <NotificationBell />}
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-9 gap-2 px-2">
                <Avatar className="size-7">
                  <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                </Avatar>
                <span className="hidden text-sm font-medium sm:inline-block">
                  {user.fullName}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">{user.fullName}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <UserIcon />
                  Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <SettingsIcon />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
              >
                <LogOutIcon />
                {logout.isPending ? 'Signing out...' : 'Sign out'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
