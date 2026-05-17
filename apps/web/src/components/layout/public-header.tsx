'use client';

import Link from 'next/link';
import { LogOutIcon, SettingsIcon, UserIcon } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLogout } from '@/features/auth/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';

const NAV_LINKS: Array<{ label: string; href: string }> = [
  { label: 'Bar Exams', href: '/bar-exams' },
  { label: 'Features', href: '/#features' },
  { label: 'Blog', href: '/blog' },
  { label: 'Pricing', href: '/pricing' },
];

export function PublicHeader() {
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
    <header
      className="sticky top-0 z-50 border-b backdrop-blur"
      style={{
        background: 'rgba(246, 241, 232, 0.92)',
        borderColor: 'var(--warm-line)',
      }}
    >
      <div className="mx-auto flex max-w-[1320px] items-center gap-7 px-6 py-4 sm:px-10">
        <Link
          href="/"
          aria-label="LIBERTASIAN"
          className="flex items-center gap-2.5"
        >
          <span
            className="flex h-9 w-9 items-center justify-center rounded-[10px] text-[22px] font-medium leading-none"
            style={{
              background: 'var(--warm-ink)',
              color: 'var(--warm-cream)',
              fontFamily: 'var(--font-display)',
              letterSpacing: '-0.5px',
            }}
          >
            L
          </span>
          <span
            className="text-[22px] font-medium tracking-[-0.6px] sm:text-2xl"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--warm-ink)' }}
          >
            libertasian
          </span>
        </Link>

        <div className="flex-1" />

        <nav className="hidden items-center gap-7 lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium transition-opacity hover:opacity-70"
              style={{ color: 'var(--warm-ink-soft)' }}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {!user && (
            <>
              <Link
                href="/auth/callback?mode=login"
                className="hidden text-sm font-medium transition-opacity hover:opacity-70 sm:inline-flex"
                style={{ color: 'var(--warm-ink)' }}
              >
                Log in
              </Link>
              <Link
                href="/auth/callback?mode=register"
                className="inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-opacity hover:opacity-90"
                style={{ background: 'var(--warm-ink)', color: 'var(--warm-cream)' }}
              >
                Get Started <span aria-hidden>→</span>
              </Link>
            </>
          )}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-9 gap-2 px-2">
                  <Avatar className="size-7">
                    <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                  </Avatar>
                  <span
                    className="hidden text-sm font-medium sm:inline-block"
                    style={{ color: 'var(--warm-ink)' }}
                  >
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
                  <Link href="/search">
                    <UserIcon />
                    Dashboard
                  </Link>
                </DropdownMenuItem>
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
      </div>
    </header>
  );
}
