'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuthStore } from '@/stores/auth-store';
import { Wordmark } from '@/components/brand/wordmark';
import { useSubscription, meetsMinimumTier } from '@/features/billing/hooks/use-subscription';
import { useCanAccessPaidFeature } from '@/hooks/useCanAccessPaidFeature';
import { useMyPermissions } from '@/features/settings/hooks/use-rbac';
import {
  ADMIN_NAV_ITEMS,
  visibleAdminNavItems,
  type AdminNavItem,
} from '@/components/layout/admin-nav';
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

/**
 * A sidebar entry: an admin entry's shape with `permission` optional (product
 * and workspace entries have none) plus the tier gate.
 *
 * `icon` is `React.ElementType` via the UMD global, matching admin-nav.tsx.
 * With two copies of @types/react resolvable in this workspace, importing
 * `ElementType` explicitly instead yields a type JSX will not accept.
 */
interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  exact?: boolean;
  minTier?: string;
  /**
   * PLATFORM permission codes, ANY of which reveals this entry (admin entries
   * only). It hides; it does not protect — each destination keeps its own
   * server-side guard, and that guard is the control (P3).
   */
  permissions?: string[];
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
  { href: '/workspace/matters', label: 'Matters', icon: FolderIcon, minTier: 'pro' },
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


export function SidebarContent() {
  const user = useAuthStore((s) => s.user);
  // Admin nav is permission-driven, not a single all-or-nothing flag. Each
  // entry declares a PLATFORM permission code and only the entries the caller
  // actually holds are rendered — so a reviewer sees the review queue and
  // nothing else, instead of either everything or (as before) nothing.
  //
  // visibleAdminNavItems is shared with the /admin route guard, so the nav and
  // the guard cannot disagree about who gets in.
  const { data: me } = useMyPermissions();
  const adminItems = visibleAdminNavItems(me?.platformPermissions);
  const showAdmin = adminItems.length > 0;
  // Separate from showAdmin: the /settings/* pages below are wrapped in
  // <PlatformAdminGate>, which still keys on isPlatformAdmin.
  const isPlatformAdmin = me?.isPlatformAdmin === true;
  const pathname = usePathname();
  const { data: subscription } = useSubscription();
  const currentPlan = subscription?.planCode;
  // Platform admins bypass the per-item tier gate so the sidebar never
  // renders padlock icons for them. Source-of-truth hook — the same one
  // every other paywall surface consults.
  const { canAccess: bypassTierGate } = useCanAccessPaidFeature();

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
    const locked =
      !bypassTierGate &&
      item.minTier &&
      !meetsMinimumTier(currentPlan, item.minTier);
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
          {/*
            These four pages are wrapped in <PlatformAdminGate>, which
            redirects anyone without isPlatformAdmin to /search. The link must
            use the SAME signal or it becomes a link that bounces you.

            They are org-scoped surfaces behind a platform-admin gate, which is
            arguably the wrong gate — /settings/members administers the
            caller's OWN organization — but changing who may administer their
            own org is a product decision, not a side effect of this PR.
          */}
          {isPlatformAdmin && renderSettingsLink('/settings/members', 'Members & Roles', ShieldCheckIcon)}
          {isPlatformAdmin && renderSettingsLink('/settings/roles', 'Roles & Permissions', LockIcon)}
          {isPlatformAdmin && renderSettingsLink('/settings/audit-logs', 'Audit Logs', ScrollTextIcon)}
          {isPlatformAdmin && renderSettingsLink('/settings/analytics', 'Org Analytics', BarChart3Icon)}
        </nav>

        {showAdmin && (
          <>
            <Separator className="my-4 bg-warm-ink/10" />
            <div>
              <div className="mb-2 flex items-center gap-2 px-3">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-warm-ink-faint">
                  Admin
                </p>
                {/*
                  Was `user.role` — the LEGACY organization_members.role
                  column, which for platform staff reads 'owner' (their
                  personal workspace) and says nothing about why they are
                  here. Roles are data now; the honest label is the standing.
                */}
                <Badge
                  variant="secondary"
                  className="border border-warm-ink/15 bg-warm-cream text-[10px] text-warm-ink-soft"
                >
                  {me?.isPlatformAdmin ? 'platform admin' : 'platform staff'}
                </Badge>
              </div>
              <nav className="space-y-1">
                {adminItems.map(renderNavItem)}
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
