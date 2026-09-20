import {
  ActivityIcon,
  ArchiveRestoreIcon,
  AwardIcon,
  BarChart3Icon,
  BookOpenIcon,
  BrainCircuitIcon,
  ClipboardCheckIcon,
  CopyIcon,
  CreditCardIcon,
  DatabaseIcon,
  DownloadCloudIcon,
  FileStackIcon,
  FlagIcon,
  FolderTreeIcon,
  GraduationCapIcon,
  HeartPulseIcon,
  HomeIcon,
  LayersIcon,
  LayoutDashboardIcon,
  MegaphoneIcon,
  NetworkIcon,
  PlayCircleIcon,
  ScanLineIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TagsIcon,
  TicketIcon,
  TimerIcon,
  UsersIcon,
  WalletIcon,
} from 'lucide-react';

/**
 * A single admin navigation entry.
 *
 * `permissions` are PLATFORM permission codes, and ANY one of them grants
 * visibility — mirroring the server's
 * `@RequiredPermissions({ permissions: [...], mode: 'any' })`. Each entry
 * declares exactly what its destination's guard accepts, so the nav and the
 * API agree about who may do what (P6).
 *
 * Resolved against platform-org permissions only, never the caller's personal
 * workspace, because owning a workspace must confer nothing over shared corpus
 * content (P2).
 *
 * This HIDES; it does not protect. Every destination keeps its own server-side
 * guard, and that guard is the control (P3).
 */
export interface AdminNavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  exact?: boolean;
  permissions: string[];
}

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboardIcon, exact: true, permissions: ['admin:dashboard'] },

  // 1 — Source setup
  { href: '/admin/sources', label: 'Sources', icon: DatabaseIcon, permissions: ['admin:ingestion'] },
  { href: '/admin/ai-settings', label: 'AI Settings', icon: BrainCircuitIcon, permissions: ['admin:ai-settings'] },
  { href: '/admin/budget', label: 'Budget', icon: WalletIcon, permissions: ['admin:ai-settings'] },

  // 2 — Crawl / ingestion
  { href: '/admin/ingestion', label: 'Ingestion', icon: DownloadCloudIcon, permissions: ['admin:ingestion'] },
  { href: '/admin/backfill', label: 'Backfill', icon: ArchiveRestoreIcon, permissions: ['admin:ingestion'] },
  { href: '/admin/bar-exams', label: 'Bar Exams', icon: ScrollTextIcon, permissions: ['admin:ingestion'] },
  { href: '/admin/bar-exams/answers', label: 'Bar Exam Answers', icon: SparklesIcon, permissions: ['admin:ingestion'] },

  // 3 — Document review
  { href: '/admin/documents', label: 'Documents', icon: FileStackIcon, permissions: ['admin:documents'] },
  // Mirrors DigestsAdminController's
  // @RequiredPermissions(['digests:review','admin:review-queue'], mode 'any').
  // `reviewer` holds digests:review and NO admin:* code — listing only
  // admin:review-queue here would hide from reviewers the one surface they
  // exist to work, and the fix for that is never to grant reviewer an admin:*
  // code (subscription.guard.ts:61 treats isPlatformAdmin as a complete
  // paywall bypass).
  { href: '/admin/review', label: 'Review Queue', icon: ClipboardCheckIcon, permissions: ['admin:review-queue', 'digests:review'] },
  { href: '/admin/duplicates', label: 'Duplicates', icon: CopyIcon, permissions: ['admin:duplicates'] },
  { href: '/admin/flags', label: 'Flags', icon: FlagIcon, permissions: ['admin:review-queue'] },
  { href: '/admin/health', label: 'Source Health', icon: HeartPulseIcon, permissions: ['admin:corpus-health'] },

  // 4 — AI study material
  { href: '/admin/derivatives', label: 'Derivatives', icon: SparklesIcon, permissions: ['admin:settings'] },
  { href: '/admin/doctrines', label: 'Doctrines', icon: BookOpenIcon, permissions: ['admin:knowledge-graph'] },
  { href: '/admin/knowledge-graph', label: 'Knowledge Graph', icon: NetworkIcon, permissions: ['admin:knowledge-graph'] },
  { href: '/admin/categorize', label: 'Categorize', icon: LayersIcon, permissions: ['admin:documents'] },
  { href: '/admin/classification', label: 'Classification', icon: FolderTreeIcon, permissions: ['admin:documents'] },
  { href: '/admin/subjects', label: 'Subjects', icon: TagsIcon, permissions: ['admin:documents'] },
  { href: '/admin/golden-sets', label: 'Golden Sets', icon: AwardIcon, permissions: ['admin:ai-settings'] },
  { href: '/admin/simulator', label: 'Simulator', icon: PlayCircleIcon, permissions: ['admin:ai-settings'] },

  // 5 — Visibility telemetry
  { href: '/admin/lifecycle-events', label: 'Lifecycle Events', icon: TimerIcon, permissions: ['admin:dashboard'] },
  { href: '/admin/reporting', label: 'Reporting', icon: BarChart3Icon, permissions: ['admin:dashboard'] },

  // 6 — Analytics (read-only)
  { href: '/admin/analytics', label: 'Analytics', icon: ActivityIcon, permissions: ['admin:dashboard'] },
  { href: '/admin/analytics/mobile-scan', label: 'Mobile & Scan', icon: ScanLineIcon, permissions: ['admin:dashboard'] },
  { href: '/admin/analytics/study', label: 'Study Mode', icon: GraduationCapIcon, permissions: ['admin:dashboard'] },
  { href: '/admin/analytics/corpus', label: 'Corpus & Ingestion', icon: DatabaseIcon, permissions: ['admin:corpus-health'] },
  { href: '/admin/analytics/realtime', label: 'Real-time', icon: ActivityIcon, permissions: ['admin:dashboard'] },

  // 7 — Business surfaces
  { href: '/admin/plans', label: 'Plans', icon: CreditCardIcon, permissions: ['admin:plans'] },
  { href: '/admin/subscriptions', label: 'Subscriptions', icon: CreditCardIcon, permissions: ['admin:billing'] },
  { href: '/admin/users', label: 'Users', icon: UsersIcon, permissions: ['admin:users'] },
  // Staff administration: granting platform capability. Gated on
  // members:update-role — the permission its actions actually require — not on
  // an admin:* code, so the entry appears for exactly the people who can use
  // it. `members:read` alone gets the read-only roster via the same page.
  { href: '/admin/staff', label: 'Staff & Roles', icon: ShieldCheckIcon, permissions: ['members:update-role', 'members:read'] },
  { href: '/admin/coupons', label: 'Coupons', icon: TicketIcon, permissions: ['admin:billing'] },
  { href: '/admin/promotions', label: 'Promotions', icon: MegaphoneIcon, permissions: ['admin:billing'] },
  { href: '/admin/homepage', label: 'Homepage', icon: HomeIcon, permissions: ['admin:settings'] },
  { href: '/admin/blog', label: 'Blog', icon: BookOpenIcon, permissions: ['admin:settings'] },
  { href: '/admin/ads', label: 'Advertising', icon: MegaphoneIcon, permissions: ['admin:settings'] },
];


/**
 * The admin entries a caller may see, given their PLATFORM permission codes.
 *
 * Single source of truth, consumed by BOTH the sidebar (which renders these)
 * and the /admin route guard (which admits anyone with at least one). If the
 * two computed visibility separately they would drift, and the drift shows up
 * as either a nav entry that bounces you to /search or an admin area with an
 * empty sidebar.
 */
export function visibleAdminNavItems(
  platformPermissions: string[] | undefined,
): AdminNavItem[] {
  if (!platformPermissions || platformPermissions.length === 0) return [];
  const held = new Set(platformPermissions);
  return ADMIN_NAV_ITEMS.filter((item) =>
    item.permissions.some((code) => held.has(code)),
  );
}

/** True when the caller may open the admin area at all. */
export function canAccessAdminArea(
  platformPermissions: string[] | undefined,
): boolean {
  return visibleAdminNavItems(platformPermissions).length > 0;
}
