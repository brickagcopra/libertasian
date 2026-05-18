'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuthStore } from '@/stores/auth-store';
import { Wordmark } from '@/components/brand/wordmark';
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
  ArchiveRestoreIcon,
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
  WalletIcon,
  AwardIcon,
  TagsIcon,
  SparklesIcon,
  DownloadCloudIcon,
  FolderTreeIcon,
  LayersIcon,
  LibraryBigIcon,
  FileStackIcon,
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
  { href: '/library', label: 'Library', icon: LibraryBigIcon },
  { href: '/bar-exams', label: 'Bar Exams', icon: ScrollTextIcon },
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
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboardIcon, exact: true },

  // 1 — Source setup
  { href: '/admin/sources', label: 'Sources', icon: DatabaseIcon },
  { href: '/admin/ai-settings', label: 'AI Settings', icon: BrainCircuitIcon },
  { href: '/admin/budget', label: 'Budget', icon: WalletIcon },

  // 2 — Crawl / ingestion
  { href: '/admin/ingestion', label: 'Ingestion', icon: DownloadCloudIcon },
  { href: '/admin/backfill', label: 'Backfill', icon: ArchiveRestoreIcon },
  { href: '/admin/bar-exams', label: 'Bar Exams', icon: ScrollTextIcon },
  { href: '/admin/bar-exams/answers', label: 'Bar Exam Answers', icon: SparklesIcon },

  // 3 — Document review
  { href: '/admin/documents', label: 'Documents', icon: FileStackIcon },
  { href: '/admin/review', label: 'Review Queue', icon: ClipboardCheckIcon },
  { href: '/admin/duplicates', label: 'Duplicates', icon: CopyIcon },
  { href: '/admin/flags', label: 'Flags', icon: FlagIcon },
  { href: '/admin/health', label: 'Source Health', icon: HeartPulseIcon },

  // 4 — AI study material
  { href: '/admin/derivatives', label: 'Derivatives', icon: SparklesIcon },
  { href: '/admin/doctrines', label: 'Doctrines', icon: BookOpenIcon },
  { href: '/admin/knowledge-graph', label: 'Knowledge Graph', icon: NetworkIcon },
  { href: '/admin/categorize', label: 'Categorize', icon: LayersIcon },
  { href: '/admin/classification', label: 'Classification', icon: FolderTreeIcon },
  { href: '/admin/subjects', label: 'Subjects', icon: TagsIcon },
  { href: '/admin/golden-sets', label: 'Golden Sets', icon: AwardIcon },
  { href: '/admin/simulator', label: 'Simulator', icon: PlayCircleIcon },

  // 5 — Visibility telemetry
  { href: '/admin/lifecycle-events', label: 'Lifecycle Events', icon: TimerIcon },
  { href: '/admin/reporting', label: 'Reporting', icon: BarChart3Icon },

  // 6 — Analytics (read-only)
  { href: '/admin/analytics', label: 'Analytics', icon: ActivityIcon },
  { href: '/admin/analytics/mobile-scan', label: 'Mobile & Scan', icon: ScanLineIcon },
  { href: '/admin/analytics/study', label: 'Study Mode', icon: GraduationCapIcon },
  { href: '/admin/analytics/corpus', label: 'Corpus & Ingestion', icon: DatabaseIcon },
  { href: '/admin/analytics/realtime', label: 'Real-time', icon: ActivityIcon },

  // 7 — Business surfaces
  { href: '/admin/plans', label: 'Plans', icon: CreditCardIcon },
  { href: '/admin/subscriptions', label: 'Subscriptions', icon: CreditCardIcon },
  { href: '/admin/coupons', label: 'Coupons', icon: TicketIcon },
  { href: '/admin/promotions', label: 'Promotions', icon: MegaphoneIcon },
  { href: '/admin/homepage', label: 'Homepage', icon: HomeIcon },
  { href: '/admin/blog', label: 'Blog', icon: BookOpenIcon },
  { href: '/admin/ads', label: 'Advertising', icon: MegaphoneIcon },
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

  // Compute the single most-specific nav href for the current pathname so
  // that hierarchical entries (`/admin` → `/admin/blog`,
  // `/admin/analytics` → `/admin/analytics/realtime`, …) only ever
  // highlight one row at a time. Exact-only items still match strictly.
  const SETTINGS_NAV: NavItem[] = [
    { href: '/settings', label: 'Settings', icon: SettingsIcon, exact: true },
    { href: '/settings/usage', label: 'Usage', icon: BarChart3Icon },
    { href: '/settings/members', label: 'Members', icon: ShieldCheckIcon },
    { href: '/settings/roles', label: 'Roles', icon: LockIcon },
    { href: '/settings/audit-logs', label: 'Audit Logs', icon: ScrollTextIcon },
    { href: '/settings/analytics', label: 'Org Analytics', icon: BarChart3Icon },
  ];
  const allItems: NavItem[] = [
    ...NAV_ITEMS,
    ...WORKSPACE_ITEMS,
    ...ADMIN_NAV_ITEMS,
    ...SETTINGS_NAV,
  ];
  const matchingHrefs = allItems
    .filter((i) =>
      i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(i.href + '/'),
    )
    .map((i) => i.href);
  const activeHref = matchingHrefs.sort((a, b) => b.length - a.length)[0];

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return href === activeHref;
  };

  const renderNavItem = (item: NavItem) => {
    const locked = item.minTier && !meetsMinimumTier(currentPlan, item.minTier);
    const Icon = item.icon;
    const active = isActive(item.href, item.exact);

    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          // Inactive — muted ink against the warm sidebar
          'text-warm-ink-mid hover:bg-warm-cream-2 hover:text-warm-ink',
          // Active — ink bg + cream text + amber left border
          active && 'bg-warm-ink text-warm-cream hover:bg-warm-ink hover:text-warm-cream',
          locked && 'opacity-50',
        )}
        title={
          locked
            ? `Requires ${item.minTier!.charAt(0).toUpperCase() + item.minTier!.slice(1)} plan`
            : undefined
        }
      >
        {active && (
          <span
            aria-hidden
            className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-sm bg-warm-accent"
          />
        )}
        <Icon className="size-4 shrink-0" />
        <span className="flex-1 truncate">{item.label}</span>
        {locked && <LockIcon className="size-3.5 shrink-0" />}
      </Link>
    );
  };

  // Eyebrow label — JetBrains Mono, 11px, uppercase, faint ink
  const eyebrowClass =
    'mb-2 px-3 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-warm-ink-faint';

  const renderSettingsLink = (
    href: string,
    label: string,
    Icon: React.ElementType,
    exact?: boolean,
  ) => {
    const active = isActive(href, exact);
    return (
      <Link
        href={href}
        className={cn(
          'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          'text-warm-ink-mid hover:bg-warm-cream-2 hover:text-warm-ink',
          active && 'bg-warm-ink text-warm-cream hover:bg-warm-ink hover:text-warm-cream',
        )}
      >
        {active && (
          <span
            aria-hidden
            className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-sm bg-warm-accent"
          />
        )}
        <Icon className="size-4 shrink-0" />
        <span>{label}</span>
      </Link>
    );
  };

  return (
    <div className="flex h-full flex-col bg-warm-cream-2">
      <div className="flex h-14 items-center border-b border-warm-ink/10 px-4">
        <Wordmark size={32} />
      </div>

      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="space-y-1">
          {NAV_ITEMS.map(renderNavItem)}
        </nav>

        <Separator className="my-4 bg-warm-ink/10" />

        <div>
          <p className={eyebrowClass}>Workspace</p>
          <nav className="space-y-1">
            {WORKSPACE_ITEMS.map(renderNavItem)}
          </nav>
        </div>

        <Separator className="my-4 bg-warm-ink/10" />

        <nav className="space-y-1">
          {renderSettingsLink('/settings', 'Settings', SettingsIcon, true)}
          {renderSettingsLink('/settings/usage', 'Usage & Quotas', BarChart3Icon)}
          {canViewMembers && renderSettingsLink('/settings/members', 'Members & Roles', ShieldCheckIcon)}
          {canViewRoles && renderSettingsLink('/settings/roles', 'Roles & Permissions', LockIcon)}
          {canViewAuditLogs && renderSettingsLink('/settings/audit-logs', 'Audit Logs', ScrollTextIcon)}
          {renderSettingsLink('/settings/analytics', 'Org Analytics', BarChart3Icon)}
        </nav>

        {showAdmin && (
          <>
            <Separator className="my-4 bg-warm-ink/10" />
            <div>
              <div className="mb-2 flex items-center gap-2 px-3">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-warm-ink-faint">
                  Admin
                </p>
                <Badge
                  variant="secondary"
                  className="border border-warm-ink/15 bg-warm-cream text-[10px] text-warm-ink-soft"
                >
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
    <aside className="hidden w-64 border-r border-warm-ink/10 md:block">
      <SidebarContent />
    </aside>
  );
}
