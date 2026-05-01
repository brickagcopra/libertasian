'use client';

import { usePathname } from 'next/navigation';

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Hand-tuned overrides for routes whose slug doesn't title-case cleanly.
const TITLE_OVERRIDES: Record<string, string> = {
  '': 'Dashboard',
  '/': 'Dashboard',
  '/admin': 'Dashboard',
  '/admin/ai-settings': 'AI Settings',
  '/admin/bar-exams': 'Bar Exams',
  '/admin/analytics/mobile-scan': 'Mobile & Scan',
  '/admin/analytics/study': 'Study Mode',
  '/admin/analytics/corpus': 'Corpus & Ingestion',
  '/admin/analytics/realtime': 'Real-time',
  '/admin/analytics/search-ai': 'Search AI',
  '/admin/analytics/revenue': 'Revenue',
  '/admin/analytics/retention': 'Retention',
  '/admin/knowledge-graph': 'Knowledge Graph',
  '/admin/lifecycle-events': 'Lifecycle Events',
  '/admin/golden-sets': 'Golden Sets',
  '/admin/review': 'Review Queue',
  '/admin/health': 'Source Health',
  '/settings/usage': 'Usage & Quotas',
  '/settings/members': 'Members & Roles',
  '/settings/roles': 'Roles & Permissions',
  '/settings/audit-logs': 'Audit Logs',
  '/settings/analytics': 'Org Analytics',
};

function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function getPageTitle(pathname: string | null): string {
  const path = pathname ?? '';
  if (TITLE_OVERRIDES[path]) return TITLE_OVERRIDES[path];

  const segments = path.split('/').filter((s) => s.length > 0 && !UUID_RE.test(s));
  if (segments.length === 0) return 'Dashboard';

  const cleanPath = '/' + segments.join('/');
  if (TITLE_OVERRIDES[cleanPath]) return TITLE_OVERRIDES[cleanPath];

  return titleCase(segments[segments.length - 1] ?? 'Dashboard');
}

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const pathname = usePathname();
  const pageTitle = getPageTitle(pathname);

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
        <span className="text-sm font-medium text-muted-foreground">{pageTitle}</span>
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
