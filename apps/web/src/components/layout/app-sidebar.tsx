'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuthStore } from '@/stores/auth-store';
import { Logo } from '@/components/brand/logo';
import { useSubscription, meetsMinimumTier } from '@/features/billing/hooks/use-subscription';
import { useHasPermission } from '@/features/settings/hooks/use-rbac';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  SearchIcon,
  FileTextIcon,
  ScanLineIcon,
  GraduationCapIcon,
  UsersIcon,
  BookmarkIcon,
  FolderIcon,
  ListTodoIcon,
  CalendarIcon,
  StickyNoteIcon,
  HighlighterIcon,
  FileEditIcon,
  GitCompareArrowsIcon,
  ScrollIcon,
  ClockIcon,
  BriefcaseIcon,
  AlertTriangleIcon,
  FlaskConicalIcon,
  ActivityIcon,
  SettingsIcon,
  LayoutDashboardIcon,
  DatabaseIcon,
  ClipboardCheckIcon,
  FlagIcon,
  BookOpenIcon,
  NewspaperIcon,
  NetworkIcon,
  HeartPulseIcon,
  CopyIcon,
  CreditCardIcon,
  TicketIcon,
  MegaphoneIcon,
  PlayCircleIcon,
  LockIcon,
  ShieldCheckIcon,
  ScrollTextIcon,
  BarChart3Icon,
  BrainCircuitIcon,
  HomeIcon,
  TimerIcon,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  exact?: boolean;
  minTier?: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/search', label: 'Search', icon: SearchIcon },
  { href: '/digests', label: 'Digests', icon: FileTextIcon },
  { href: '/scans', label: 'Scans', icon: ScanLineIcon },
  { href: '/study', label: 'Study', icon: GraduationCapIcon },
  { href: '/community', label: 'Community', icon: UsersIcon },
  { href: '/feed', label: 'Feed', icon: NewspaperIcon },
  { href: '/blog', label: 'Blog', icon: BookOpenIcon },
];

const WORKSPACE_ITEMS: NavItem[] = [
  { href: '/workspace', label: 'Bookmarks', icon: BookmarkIcon, exact: true },
  { href: '/workspace/matters', label: 'Matters', icon: FolderIcon },
  { href: '/workspace/tasks', label: 'Tasks', icon: ListTodoIcon },
  { href: '/workspace/calendar', label: 'Calendar', icon: CalendarIcon },
  { href: '/workspace/notes', label: 'Notes', icon: StickyNoteIcon },
  { href: '/workspace/annotations', label: 'Annotations', icon: HighlighterIcon },
  { href: '/workspace/memos', label: 'Memos', icon: FileEditIcon, minTier: 'pro' },
  { href: '/workspace/comparisons', label: 'Comparisons', icon: GitCompareArrowsIcon, minTier: 'pro' },
  { href: '/workspace/pleadings', label: 'Pleadings', icon: ScrollIcon, minTier: 'pro' },
  { href: '/workspace/timelines', label: 'Timelines', icon: ClockIcon, minTier: 'pro' },
  { href: '/workspace/hearing-prep', label: 'Hearing Prep', icon: BriefcaseIcon, minTier: 'pro' },
  { href: '/workspace/contradictions', label: 'Contradictions', icon: AlertTriangleIcon, minTier: 'team' },
  { href: '/workspace/research-workspaces', label: 'Research', icon: FlaskConicalIcon, minTier: 'pro' },
  { href: '/workspace/activity', label: 'Activity', icon: ActivityIcon },
];

const ADMIN_NAV_ITEMS: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboardIcon },
  { href: '/admin/ai-settings', label: 'AI Settings', icon: BrainCircuitIcon },
  { href: '/admin/homepage', label: 'Homepage', icon: HomeIcon },
  { href: '/admin/sources', label: 'Sources', icon: DatabaseIcon },
  { href: '/admin/review', label: 'Review Queue', icon: ClipboardCheckIcon },
  { href: '/admin/flags', label: 'Flags', icon: FlagIcon },
  { href: '/admin/doctrines', label: 'Doctrines', icon: BookOpenIcon },
  { href: '/admin/knowledge-graph', label: 'Knowledge Graph', icon: NetworkIcon },
  { href: '/admin/health', label: 'Source Health', icon: HeartPulseIcon },
  { href: '/admin/duplicates', label: 'Duplicates', icon: CopyIcon },
  { href: '/admin/plans', label: 'Plans', icon: CreditCardIcon },
  { href: '/admin/subscriptions', label: 'Subscriptions', icon: CreditCardIcon },
  { href: '/admin/lifecycle-events', label: 'Lifecycle Events', icon: TimerIcon },
  { href: '/admin/coupons', label: 'Coupons', icon: TicketIcon },
  { href: '/admin/promotions', label: 'Promotions', icon: MegaphoneIcon },
  { href: '/admin/simulator', label: 'Simulator', icon: PlayCircleIcon },
  { href: '/admin/blog', label: 'Blog', icon: BookOpenIcon },
  { href: '/admin/ads', label: 'Advertising', icon: MegaphoneIcon },
  { href: '/admin/reporting', label: 'Reporting', icon: BarChart3Icon },
  { href: '/admin/analytics', label: 'Analytics', icon: ActivityIcon },
  { href: '/admin/analytics/mobile-scan', label: 'Mobile & Scan', icon: ScanLineIcon },
  { href: '/admin/analytics/study', label: 'Study Mode', icon: GraduationCapIcon },
  { href: '/admin/analytics/corpus', label: 'Corpus & Ingestion', icon: DatabaseIcon },
  { href: '/admin/analytics/realtime', label: 'Real-time', icon: ActivityIcon },
];

const ADMIN_ROLES = ['admin', 'editor', 'owner'];

export function SidebarContent() {
  const user = useAuthStore((s) => s.user);
  const legacyAdmin = user && ADMIN_ROLES.includes(user.role);
  const { hasPermission: rbacAdmin } = useHasPermission(
    ['documents:read', 'editorial-flags:read'],
    'any',
  );
  const { hasPermission: canViewMembers } = useHasPermission('members:read');
  const { hasPermission: canViewRoles } = useHasPermission('roles:read');
  const { hasPermission: canViewAuditLogs } = useHasPermission('audit-logs:read');
  // Show admin section if either the legacy role check or RBAC permission resolves true
  const showAdmin = legacyAdmin || rbacAdmin;
  const pathname = usePathname();
  const { data: subscription } = useSubscription();
  const currentPlan = subscription?.planCode;

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + '/');
  };

  const renderNavItem = (item: NavItem) => {
    const locked = item.minTier && !meetsMinimumTier(currentPlan, item.minTier);
    const Icon = item.icon;

    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          isActive(item.href, item.exact) && 'bg-accent text-accent-foreground',
          locked && 'opacity-50',
        )}
        title={
          locked
            ? `Requires ${item.minTier!.charAt(0).toUpperCase() + item.minTier!.slice(1)} plan`
            : undefined
        }
      >
        <Icon className="size-4 shrink-0" />
        <span className="flex-1 truncate">{item.label}</span>
        {locked && <LockIcon className="size-3.5 shrink-0 text-muted-foreground" />}
      </Link>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/">
          <Logo width={160} height={36} animated={false} />
        </Link>
      </div>

      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="space-y-1">
          {NAV_ITEMS.map(renderNavItem)}
        </nav>

        <Separator className="my-4" />

        <div>
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Workspace
          </p>
          <nav className="space-y-1">
            {WORKSPACE_ITEMS.map(renderNavItem)}
          </nav>
        </div>

        <Separator className="my-4" />

        <nav className="space-y-1">
          <Link
            href="/settings"
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              isActive('/settings', true) && 'bg-accent text-accent-foreground',
            )}
          >
            <SettingsIcon className="size-4 shrink-0" />
            <span>Settings</span>
          </Link>
          <Link
            href="/settings/usage"
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              isActive('/settings/usage') && 'bg-accent text-accent-foreground',
            )}
          >
            <BarChart3Icon className="size-4 shrink-0" />
            <span>Usage &amp; Quotas</span>
          </Link>
          {canViewMembers && (
            <Link
              href="/settings/members"
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                isActive('/settings/members') && 'bg-accent text-accent-foreground',
              )}
            >
              <ShieldCheckIcon className="size-4 shrink-0" />
              <span>Members &amp; Roles</span>
            </Link>
          )}
          {canViewRoles && (
            <Link
              href="/settings/roles"
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                isActive('/settings/roles') && 'bg-accent text-accent-foreground',
              )}
            >
              <LockIcon className="size-4 shrink-0" />
              <span>Roles &amp; Permissions</span>
            </Link>
          )}
          {canViewAuditLogs && (
            <Link
              href="/settings/audit-logs"
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                isActive('/settings/audit-logs') && 'bg-accent text-accent-foreground',
              )}
            >
              <ScrollTextIcon className="size-4 shrink-0" />
              <span>Audit Logs</span>
            </Link>
          )}
          <Link
            href="/settings/analytics"
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              isActive('/settings/analytics') && 'bg-accent text-accent-foreground',
            )}
          >
            <BarChart3Icon className="size-4 shrink-0" />
            <span>Org Analytics</span>
          </Link>
        </nav>

        {showAdmin && (
          <>
            <Separator className="my-4" />
            <div>
              <div className="mb-2 flex items-center gap-2 px-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Admin
                </p>
                <Badge variant="secondary" className="text-[10px]">
                  {user.role}
                </Badge>
              </div>
              <nav className="space-y-1">
                {ADMIN_NAV_ITEMS.map(renderNavItem)}
              </nav>
            </div>
          </>
        )}
      </ScrollArea>
    </div>
  );
}

export function AppSidebar() {
  return (
    <aside className="hidden w-64 border-r bg-background md:block">
      <SidebarContent />
    </aside>
  );
}
