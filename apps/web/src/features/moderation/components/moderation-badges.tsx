'use client';

import { EyeOffIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

import { SLA_BADGE_CLASSES, formatAge, slaLevel } from '../sla';
import {
  REASON_LABELS,
  TARGET_TYPE_LABELS,
  type ModerationActionType,
  type ModerationContentStatus,
  type ModerationReason,
  type ModerationTargetType,
  type SanctionType,
} from '../types';

export function isModerationReason(value: string): value is ModerationReason {
  return Object.prototype.hasOwnProperty.call(REASON_LABELS, value);
}

/** Report reasons arrive as free strings; label the known ones, humanise the rest. */
export function reasonLabel(reason: string | null): string {
  if (!reason) return '—';
  if (isModerationReason(reason)) return REASON_LABELS[reason];
  const text = reason.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function targetTypeLabel(type: ModerationTargetType | 'user'): string {
  return type === 'user' ? 'User' : TARGET_TYPE_LABELS[type];
}

/** `{ spam: 2, harassment: 1 }` → top N entries, highest count first. */
export function topReasons(reasons: Record<string, number>, n = 2): Array<[string, number]> {
  return Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

export function SlaBadge({ firstReportedAt }: { firstReportedAt: string }) {
  const level = slaLevel(firstReportedAt);
  const title =
    level === 'overdue'
      ? 'Past the 24h review promise'
      : level === 'due_soon'
        ? 'Due within 24h of the first report'
        : 'Within SLA';
  return (
    <Badge
      variant="secondary"
      className={SLA_BADGE_CLASSES[level]}
      title={title}
      data-sla={level}
    >
      {formatAge(firstReportedAt)}
    </Badge>
  );
}

const CONTENT_STATUS: Record<ModerationContentStatus, { label: string; className: string }> = {
  visible: { label: 'Visible', className: 'bg-green-100 text-green-700' },
  hidden: { label: 'Hidden', className: 'bg-amber-100 text-amber-700' },
  removed: { label: 'Removed', className: 'bg-red-100 text-red-700' },
  deleted: { label: 'Deleted by author', className: 'bg-gray-100 text-gray-700' },
  unknown: { label: 'Missing', className: 'bg-gray-100 text-gray-600' },
};

export function ContentStatusBadge({ status }: { status: ModerationContentStatus }) {
  const s = CONTENT_STATUS[status];
  return (
    <Badge variant="secondary" className={s.className}>
      {s.label}
    </Badge>
  );
}

export function AutoHiddenBadge() {
  return (
    <Badge variant="secondary" className="bg-orange-100 text-orange-700">
      <EyeOffIcon />
      Auto-hidden
    </Badge>
  );
}

const SANCTION_CLASSES: Record<SanctionType, string> = {
  warning: 'bg-amber-100 text-amber-700',
  suspension: 'bg-orange-100 text-orange-700',
  ban: 'bg-red-100 text-red-700',
};

const SANCTION_LABELS: Record<SanctionType, string> = {
  warning: 'Warning',
  suspension: 'Suspension',
  ban: 'Ban',
};

export function SanctionTypeBadge({ type }: { type: SanctionType }) {
  return (
    <Badge variant="secondary" className={SANCTION_CLASSES[type]}>
      {SANCTION_LABELS[type]}
    </Badge>
  );
}

export const ACTION_LABELS: Record<ModerationActionType, string> = {
  dismiss: 'Dismissed reports',
  remove: 'Removed content',
  restore: 'Restored content',
  auto_hide: 'Auto-hidden',
  warn: 'Warned',
  suspend: 'Suspended',
  ban: 'Banned',
  revoke_sanction: 'Revoked sanction',
};
